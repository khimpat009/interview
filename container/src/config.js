module.exports = {
  inputBucket: process.env.INPUT_BUCKET,
  inputKey: process.env.INPUT_KEY,
  outputBucket: process.env.OUTPUT_BUCKET || process.env.INPUT_BUCKET,
  modelPath: process.env.MODEL_PATH || "/app/models/yolov8n.onnx",
  confidenceThreshold: parseFloat(process.env.CONFIDENCE_THRESHOLD || "0.4"),
  blurSigma: parseInt(process.env.BLUR_SIGMA || "25", 10),
  detectInterval: parseInt(process.env.DETECT_INTERVAL || "1", 10),
};
