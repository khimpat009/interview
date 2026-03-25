/**
 * local-test.js — Run the pipeline locally without S3.
 * Used by scripts/test-local.sh
 *
 * Expects:
 *   /tmp/work/input.mp4  (mounted input video)
 *   /output/              (mounted output directory)
 */
const path = require("path");
const fsp = require("fs/promises");
const { Detector } = require("./detector");
const { VideoProcessor } = require("./video-processor");

async function main() {
  console.log("=== Video Processing — Local Test Mode ===");

  const inputPath = "/tmp/work/input.mp4";
  const workDir = "/tmp/work";
  const outputVideoPath = "/output/output.mp4";
  const outputJsonPath = "/output/detections.json";

  await fsp.mkdir(workDir, { recursive: true });

  // Verify input exists
  try {
    await fsp.access(inputPath);
  } catch {
    console.error(`Input video not found at ${inputPath}`);
    process.exit(1);
  }

  const modelPath = process.env.MODEL_PATH || "/app/models/yolov8n.onnx";
  const confidence = parseFloat(process.env.CONFIDENCE_THRESHOLD || "0.4");
  const blurSigma = parseInt(process.env.BLUR_SIGMA || "25", 10);

  // Initialise detector
  const detector = new Detector(modelPath, confidence);
  await detector.init();

  // Process
  const processor = new VideoProcessor(detector, blurSigma);
  const results = await processor.process(inputPath, outputVideoPath, workDir);

  // Write detections JSON
  await fsp.writeFile(outputJsonPath, JSON.stringify(results, null, 2));

  console.log("");
  console.log("=== Processing Complete ===");
  console.log(`  Frames processed : ${results.totalFrames}`);
  console.log(`  Frames w/ detect.: ${results.framesWithDetections}`);
  console.log(`  Total detections : ${results.totalDetections}`);
  console.log(`  Output video     : ${outputVideoPath}`);
  console.log(`  Detections JSON  : ${outputJsonPath}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
