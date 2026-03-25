const path = require("path");
const fsp = require("fs/promises");

const config = require("./config");
const { downloadFile, uploadFile, uploadJson } = require("./s3-client");
const { Detector } = require("./detector");
const { VideoProcessor } = require("./video-processor");

async function main() {
  console.log("=== Video Processing Container ===");
  console.log("Input :", `s3://${config.inputBucket}/${config.inputKey}`);
  console.log("Output:", `s3://${config.outputBucket}/output/`);

  const workDir = "/tmp/work";
  await fsp.mkdir(workDir, { recursive: true });

  const inputPath = path.join(workDir, "input.mp4");
  const outputPath = path.join(workDir, "output.mp4");

  // 1. Download input video from S3
  await downloadFile(config.inputBucket, config.inputKey, inputPath);

  // 2. Initialise YOLOv8 detector
  const detector = new Detector(config.modelPath, config.confidenceThreshold);
  await detector.init();

  // 3. Process video (detect + mask)
  const processor = new VideoProcessor(detector, config.blurSigma);
  const results = await processor.process(inputPath, outputPath, workDir);

  // 4. Determine output keys
  const baseName = path.basename(config.inputKey, ".mp4");
  const outputVideoKey = `output/${baseName}.mp4`;
  const outputJsonKey = `output/${baseName}_detections.json`;

  // 5. Upload results to S3
  await uploadFile(config.outputBucket, outputVideoKey, outputPath);
  await uploadJson(config.outputBucket, outputJsonKey, results);

  console.log("=== Processing Complete ===");
  console.log(`  Frames processed : ${results.totalFrames}`);
  console.log(`  Frames w/ detect.: ${results.framesWithDetections}`);
  console.log(`  Total detections : ${results.totalDetections}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
