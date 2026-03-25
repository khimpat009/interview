const ort = require("onnxruntime-node");
const sharp = require("sharp");

// COCO classes of interest
const PERSON_CLASS = 0;
const VEHICLE_CLASSES = [2, 3, 5, 7]; // car, motorcycle, bus, truck
const CLASS_NAMES = {
  0: "person",
  2: "car",
  3: "motorcycle",
  5: "bus",
  7: "truck",
};

class Detector {
  constructor(modelPath, confidenceThreshold = 0.4) {
    this.modelPath = modelPath;
    this.confidenceThreshold = confidenceThreshold;
    this.iouThreshold = 0.45;
    this.inputSize = 640;
    this.session = null;
  }

  async init() {
    this.session = await ort.InferenceSession.create(this.modelPath);
    console.log(
      `YOLO model loaded — inputs: [${this.session.inputNames}], outputs: [${this.session.outputNames}]`
    );
  }

  /**
   * Run detection on a single frame image.
   * Returns { detections, maskRegions }.
   */
  async detect(framePath) {
    const originalMeta = await sharp(framePath).metadata();
    const originalWidth = originalMeta.width;
    const originalHeight = originalMeta.height;

    // Resize with letterbox padding (gray fill)
    const { data: resizedPixels } = await sharp(framePath)
      .removeAlpha()
      .resize(this.inputSize, this.inputSize, {
        fit: "contain",
        background: { r: 114, g: 114, b: 114 },
      })
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Convert to float32 NCHW [1, 3, 640, 640]
    const pixelCount = this.inputSize * this.inputSize;
    const inputTensor = new Float32Array(3 * pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      inputTensor[i] = resizedPixels[i * 3] / 255.0; // R
      inputTensor[pixelCount + i] = resizedPixels[i * 3 + 1] / 255.0; // G
      inputTensor[2 * pixelCount + i] = resizedPixels[i * 3 + 2] / 255.0; // B
    }

    const tensor = new ort.Tensor("float32", inputTensor, [
      1,
      3,
      this.inputSize,
      this.inputSize,
    ]);

    // Run inference using the model's actual input/output names
    const inputName = this.session.inputNames[0];
    const results = await this.session.run({ [inputName]: tensor });
    const output = results[this.session.outputNames[0]];

    const detections = this.postProcess(output, originalWidth, originalHeight);
    const maskRegions = this.buildMaskRegions(detections, originalWidth, originalHeight);

    return { detections, maskRegions };
  }

  /* ------------------------------------------------------------------ */
  /*  Post-processing: parse YOLOv8 output → filtered detections        */
  /* ------------------------------------------------------------------ */
  postProcess(output, originalWidth, originalHeight) {
    const data = output.data;
    const numDetections = output.dims[2]; // 8400
    const numClasses = output.dims[1] - 4; // 80

    // Letterbox scale & padding
    const scale = Math.min(
      this.inputSize / originalWidth,
      this.inputSize / originalHeight
    );
    const padX = (this.inputSize - originalWidth * scale) / 2;
    const padY = (this.inputSize - originalHeight * scale) / 2;

    const candidates = [];

    for (let i = 0; i < numDetections; i++) {
      const xc = data[0 * numDetections + i];
      const yc = data[1 * numDetections + i];
      const w = data[2 * numDetections + i];
      const h = data[3 * numDetections + i];

      // Best class
      let maxScore = 0;
      let classId = -1;
      for (let c = 0; c < numClasses; c++) {
        const score = data[(4 + c) * numDetections + i];
        if (score > maxScore) {
          maxScore = score;
          classId = c;
        }
      }

      if (maxScore < this.confidenceThreshold) continue;
      if (classId !== PERSON_CLASS && !VEHICLE_CLASSES.includes(classId))
        continue;

      // Map back to original image coordinates
      const x1 = Math.max(0, (xc - w / 2 - padX) / scale);
      const y1 = Math.max(0, (yc - h / 2 - padY) / scale);
      const x2 = Math.min(originalWidth, (xc + w / 2 - padX) / scale);
      const y2 = Math.min(originalHeight, (yc + h / 2 - padY) / scale);

      candidates.push({
        classId,
        className: CLASS_NAMES[classId] || `class_${classId}`,
        confidence: parseFloat(maxScore.toFixed(4)),
        bbox: { x1, y1, x2, y2 },
      });
    }

    return this.nms(candidates);
  }

  /* ------------------------------------------------------------------ */
  /*  Build mask regions from detections                                 */
  /* ------------------------------------------------------------------ */
  buildMaskRegions(detections, imgWidth, imgHeight) {
    const regions = [];

    for (const det of detections) {
      if (det.classId === PERSON_CLASS) {
        regions.push({
          type: "person",
          confidence: det.confidence,
          bbox: det.bbox,
        });
      } else if (VEHICLE_CLASSES.includes(det.classId)) {
        // Estimate license plate area within the vehicle bounding box
        const plate = this.estimatePlateRegion(det.bbox, imgWidth, imgHeight);
        if (plate) {
          regions.push({
            type: "license_plate",
            vehicleClass: det.className,
            confidence: det.confidence,
            bbox: plate,
          });
        }
      }
    }

    return regions;
  }

  /**
   * Heuristic: license plate is typically in the lower-center portion of
   * a vehicle bounding box.
   */
  estimatePlateRegion(vehicleBbox, imgWidth, imgHeight) {
    const { x1, y1, x2, y2 } = vehicleBbox;
    const vw = x2 - x1;
    const vh = y2 - y1;

    const plateX1 = x1 + vw * 0.15;
    const plateX2 = x2 - vw * 0.15;
    const plateY1 = y1 + vh * 0.6;
    const plateY2 = y2;

    if (plateX2 - plateX1 < 20 || plateY2 - plateY1 < 10) return null;

    return {
      x1: Math.max(0, plateX1),
      y1: Math.max(0, plateY1),
      x2: Math.min(imgWidth, plateX2),
      y2: Math.min(imgHeight, plateY2),
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Non-Maximum Suppression                                            */
  /* ------------------------------------------------------------------ */
  nms(detections) {
    const byClass = {};
    for (const d of detections) {
      (byClass[d.classId] ??= []).push(d);
    }

    const result = [];
    for (const dets of Object.values(byClass)) {
      dets.sort((a, b) => b.confidence - a.confidence);
      const suppressed = new Set();

      for (let i = 0; i < dets.length; i++) {
        if (suppressed.has(i)) continue;
        result.push(dets[i]);
        for (let j = i + 1; j < dets.length; j++) {
          if (this.iou(dets[i].bbox, dets[j].bbox) > this.iouThreshold) {
            suppressed.add(j);
          }
        }
      }
    }
    return result;
  }

  iou(a, b) {
    const ix1 = Math.max(a.x1, b.x1);
    const iy1 = Math.max(a.y1, b.y1);
    const ix2 = Math.min(a.x2, b.x2);
    const iy2 = Math.min(a.y2, b.y2);
    const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
    const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
    const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
    return inter / (areaA + areaB - inter);
  }
}

module.exports = { Detector };
