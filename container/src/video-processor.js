const { execSync } = require("child_process");
const sharp = require("sharp");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { Tracker } = require("./tracker");

class VideoProcessor {
  constructor(detector, blurSigma = 25, detectInterval = 3) {
    this.detector = detector;
    this.blurSigma = blurSigma;
    this.detectInterval = Math.max(1, detectInterval);
  }

  /**
   * Full pipeline: extract frames → detect → blur → reassemble.
   * Returns a results object suitable for the detections JSON.
   */
  async process(inputPath, outputPath, workDir) {
    const framesDir = path.join(workDir, "frames");
    const processedDir = path.join(workDir, "processed");
    await fsp.mkdir(framesDir, { recursive: true });
    await fsp.mkdir(processedDir, { recursive: true });

    // 1. Probe the video
    const videoInfo = this.getVideoInfo(inputPath);
    console.log("Video info:", JSON.stringify(videoInfo));

    // 2. Extract frames
    console.log("Extracting frames with FFmpeg...");
    this.extractFrames(inputPath, framesDir);

    const frameFiles = (await fsp.readdir(framesDir))
      .filter((f) => f.endsWith(".jpg"))
      .sort();
    console.log(`Extracted ${frameFiles.length} frames`);

    // 3. Detect & blur each frame (with motion tracking for faces)
    //    Run YOLO only on key frames (every N-th); use tracker prediction
    //    on skipped frames for efficiency.
    const allDetections = {};
    let framesWithDetections = 0;
    let totalDetections = 0;
    let framesDetected = 0;
    const tracker = new Tracker();
    let lastPlateRegions = [];

    console.log(`Detect interval: every ${this.detectInterval} frame(s)`);

    for (let i = 0; i < frameFiles.length; i++) {
      const file = frameFiles[i];
      const framePath = path.join(framesDir, file);
      const outFramePath = path.join(processedDir, file);

      if ((i + 1) % 50 === 0 || i === 0) {
        console.log(`Processing frame ${i + 1} / ${frameFiles.length}...`);
      }

      const isKeyFrame = i % this.detectInterval === 0;
      let detections = [];
      let trackedRegions;

      if (isKeyFrame) {
        // Key frame: run YOLO detection + tracker update
        const result = await this.detector.detect(framePath);
        detections = result.detections;

        trackedRegions = tracker.process(
          result.maskRegions,
          videoInfo.width,
          videoInfo.height
        );

        // Remember plate regions for skipped frames
        lastPlateRegions = trackedRegions.filter(
          (r) => r.type === "license_plate"
        );
        framesDetected++;
      } else {
        // Skipped frame: predict all tracks using velocity
        trackedRegions = tracker.predictAll(
          videoInfo.width,
          videoInfo.height,
          lastPlateRegions
        );
      }

      if (trackedRegions.length > 0) {
        framesWithDetections++;
        totalDetections += trackedRegions.length;
        await this.applyBlur(framePath, outFramePath, trackedRegions);
      } else {
        await fsp.copyFile(framePath, outFramePath);
      }

      allDetections[file] = {
        frameNumber: i + 1,
        detections,
        maskRegions: trackedRegions,
      };
    }

    console.log(`YOLO ran on ${framesDetected} / ${frameFiles.length} frames (interval=${this.detectInterval})`);

    // 4. Reassemble video
    console.log("Reassembling video with FFmpeg...");
    this.assembleVideo(processedDir, inputPath, outputPath, videoInfo.fps);

    // 5. Clean up temp directories
    await fsp.rm(framesDir, { recursive: true, force: true });
    await fsp.rm(processedDir, { recursive: true, force: true });

    return {
      totalFrames: frameFiles.length,
      framesWithDetections,
      totalDetections,
      fps: videoInfo.fps,
      resolution: videoInfo.resolution,
      detections: allDetections,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  FFmpeg helpers                                                     */
  /* ------------------------------------------------------------------ */

  getVideoInfo(inputPath) {
    const raw = execSync(
      `ffprobe -v quiet -print_format json -show_streams "${inputPath}"`,
      { encoding: "utf-8" }
    );
    const probe = JSON.parse(raw);
    const vs = probe.streams.find((s) => s.codec_type === "video");

    let fps = 30;
    if (vs.r_frame_rate) {
      const [num, den] = vs.r_frame_rate.split("/");
      fps = den ? num / den : parseFloat(num);
    }

    return {
      fps: Math.round(fps * 100) / 100,
      resolution: `${vs.width}x${vs.height}`,
      width: parseInt(vs.width),
      height: parseInt(vs.height),
      duration: parseFloat(vs.duration || "0"),
    };
  }

  extractFrames(inputPath, outputDir) {
    execSync(
      `ffmpeg -i "${inputPath}" -qscale:v 2 "${path.join(outputDir, "frame_%06d.jpg")}"`,
      { stdio: "pipe" }
    );
  }

  assembleVideo(framesDir, originalPath, outputPath, fps) {
    let hasAudio = false;
    try {
      const raw = execSync(
        `ffprobe -v quiet -print_format json -show_streams "${originalPath}"`,
        { encoding: "utf-8" }
      );
      hasAudio = JSON.parse(raw).streams.some(
        (s) => s.codec_type === "audio"
      );
    } catch {
      /* no audio */
    }

    const framesInput = `"${path.join(framesDir, "frame_%06d.jpg")}"`;

    if (hasAudio) {
      execSync(
        `ffmpeg -framerate ${fps} -i ${framesInput} ` +
          `-i "${originalPath}" -map 0:v -map 1:a ` +
          `-c:v libx264 -pix_fmt yuv420p -c:a copy -shortest -y "${outputPath}"`,
        { stdio: "pipe" }
      );
    } else {
      execSync(
        `ffmpeg -framerate ${fps} -i ${framesInput} ` +
          `-c:v libx264 -pix_fmt yuv420p -y "${outputPath}"`,
        { stdio: "pipe" }
      );
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Blur mask regions onto a frame using sharp                         */
  /* ------------------------------------------------------------------ */

  async applyBlur(framePath, outputPath, maskRegions) {
    const meta = await sharp(framePath).metadata();
    const composites = [];

    for (const region of maskRegions) {
      const { x1, y1, x2, y2 } = region.bbox;
      const left = Math.max(0, Math.round(x1));
      const top = Math.max(0, Math.round(y1));
      let width = Math.round(x2 - x1);
      let height = Math.round(y2 - y1);

      width = Math.min(width, meta.width - left);
      height = Math.min(height, meta.height - top);
      if (width <= 2 || height <= 2) continue;

      const blurred = await sharp(framePath)
        .extract({ left, top, width, height })
        .blur(this.blurSigma)
        .toBuffer();

      composites.push({ input: blurred, left, top });
    }

    if (composites.length > 0) {
      await sharp(framePath)
        .composite(composites)
        .jpeg({ quality: 95 })
        .toFile(outputPath);
    } else {
      await fsp.copyFile(framePath, outputPath);
    }
  }
}

module.exports = { VideoProcessor };
