

const IOU_MATCH_THRESHOLD = 0.2;
const MAX_MISSING_FRAMES = 8; // predict up to 8 frames without detection
const VELOCITY_SMOOTHING = 0.6; // exponential smoothing factor for velocity

class Track {
  constructor(id, bbox, type) {
    this.id = id;
    this.bbox = { ...bbox };
    this.type = type;
    this.vx = 0; // velocity: center-x per frame
    this.vy = 0; // velocity: center-y per frame
    this.age = 0; // total frames since creation
    this.missingFrames = 0; // consecutive frames without a match
    this.confidence = 0;
  }

  get cx() { return (this.bbox.x1 + this.bbox.x2) / 2; }
  get cy() { return (this.bbox.y1 + this.bbox.y2) / 2; }
  get w()  { return this.bbox.x2 - this.bbox.x1; }
  get h()  { return this.bbox.y2 - this.bbox.y1; }

  update(bbox, confidence) {
    const newCx = (bbox.x1 + bbox.x2) / 2;
    const newCy = (bbox.y1 + bbox.y2) / 2;
    const dvx = newCx - this.cx;
    const dvy = newCy - this.cy;

    // Exponential moving average for smooth velocity
    this.vx = VELOCITY_SMOOTHING * dvx + (1 - VELOCITY_SMOOTHING) * this.vx;
    this.vy = VELOCITY_SMOOTHING * dvy + (1 - VELOCITY_SMOOTHING) * this.vy;

    this.bbox = { ...bbox };
    this.confidence = confidence;
    this.missingFrames = 0;
    this.age++;
  }

  predict(imgWidth, imgHeight) {
    this.missingFrames++;
    this.age++;

    // Shift bbox by velocity
    const hw = this.w / 2;
    const hh = this.h / 2;
    const ncx = this.cx + this.vx;
    const ncy = this.cy + this.vy;

    this.bbox = {
      x1: Math.max(0, ncx - hw),
      y1: Math.max(0, ncy - hh),
      x2: Math.min(imgWidth, ncx + hw),
      y2: Math.min(imgHeight, ncy + hh),
    };

    // Decay confidence over missing frames
    this.confidence = Math.max(0.1, this.confidence * 0.85);
  }

  isExpired() {
    return this.missingFrames > MAX_MISSING_FRAMES;
  }
}

class Tracker {
  constructor() {
    this.nextId = 1;
    this.tracks = [];
  }

  /**
   * Update tracks with new detections for the current frame.
   * Returns the final maskRegions (detected + predicted).
   */
  process(maskRegions, imgWidth, imgHeight) {
    // Separate face regions (tracked) from plate regions (pass-through)
    const faceRegions = maskRegions.filter((r) => r.type === "face");
    const plateRegions = maskRegions.filter((r) => r.type === "license_plate");

    // Match detected faces to existing tracks using IoU
    const matched = new Set();    // indices of matched detections
    const matchedTracks = new Set(); // indices of matched tracks

    // Build cost matrix and greedily assign
    const pairs = [];
    for (let ti = 0; ti < this.tracks.length; ti++) {
      for (let di = 0; di < faceRegions.length; di++) {
        const score = iou(this.tracks[ti].bbox, faceRegions[di].bbox);
        if (score >= IOU_MATCH_THRESHOLD) {
          pairs.push({ ti, di, score });
        }
      }
    }
    pairs.sort((a, b) => b.score - a.score);

    for (const { ti, di } of pairs) {
      if (matchedTracks.has(ti) || matched.has(di)) continue;
      this.tracks[ti].update(faceRegions[di].bbox, faceRegions[di].confidence);
      matched.add(di);
      matchedTracks.add(ti);
    }

    // Predict unmatched tracks (walking person temporarily lost)
    for (let ti = 0; ti < this.tracks.length; ti++) {
      if (!matchedTracks.has(ti)) {
        this.tracks[ti].predict(imgWidth, imgHeight);
      }
    }

    // Create new tracks for unmatched detections
    for (let di = 0; di < faceRegions.length; di++) {
      if (!matched.has(di)) {
        const t = new Track(this.nextId++, faceRegions[di].bbox, "face");
        t.confidence = faceRegions[di].confidence;
        this.tracks.push(t);
      }
    }

    // Remove expired tracks
    this.tracks = this.tracks.filter((t) => !t.isExpired());

    // Build output: all active tracks as face regions + plate pass-through
    const output = [];
    for (const t of this.tracks) {
      output.push({
        type: "face",
        trackId: t.id,
        confidence: t.confidence,
        predicted: t.missingFrames > 0,
        bbox: { ...t.bbox },
      });
    }

    for (const p of plateRegions) {
      output.push(p);
    }

    return output;
  }

  /**
   * Predict-only step for skipped frames (no detection was run).
   * Advances all tracks using velocity and returns predicted regions.
   * License plate tracks use last known position (no plate tracking).
   */
  predictAll(imgWidth, imgHeight, lastPlateRegions) {
    for (const t of this.tracks) {
      t.predict(imgWidth, imgHeight);
    }
    this.tracks = this.tracks.filter((t) => !t.isExpired());

    const output = [];
    for (const t of this.tracks) {
      output.push({
        type: "face",
        trackId: t.id,
        confidence: t.confidence,
        predicted: true,
        bbox: { ...t.bbox },
      });
    }

    // Re-use last known plate regions on skipped frames
    for (const p of lastPlateRegions) {
      output.push(p);
    }

    return output;
  }
}

function iou(a, b) {
  const ix1 = Math.max(a.x1, b.x1);
  const iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2);
  const iy2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  return inter / (areaA + areaB - inter);
}

module.exports = { Tracker };
