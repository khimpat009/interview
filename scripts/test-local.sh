#!/usr/bin/env bash
# test-local.sh — Run the video processing pipeline locally with Docker
# Usage: ./scripts/test-local.sh <path-to-video.mp4>
set -euo pipefail

VIDEO_PATH="${1:?Usage: ./scripts/test-local.sh <path-to-video.mp4>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [ ! -f "$VIDEO_PATH" ]; then
  echo "ERROR: File not found: $VIDEO_PATH"
  exit 1
fi

ABS_VIDEO="$(cd "$(dirname "$VIDEO_PATH")" && pwd)/$(basename "$VIDEO_PATH")"
OUTPUT_DIR="$PROJECT_DIR/output"
mkdir -p "$OUTPUT_DIR"

echo "============================================"
echo " Local Test — Video Processing POC"
echo " Input : $ABS_VIDEO"
echo " Output: $OUTPUT_DIR/"
echo "============================================"
echo ""

# Build the container
echo ">>> Building Docker image (first build downloads YOLOv8n model — may take a few minutes)..."
docker build -t video-processor-local "$PROJECT_DIR/container"

# Run the container locally (no AWS credentials needed — uses local filesystem)
echo ""
echo ">>> Running video processing..."
docker run --rm \
  -v "$ABS_VIDEO:/tmp/work/input.mp4:ro" \
  -v "$OUTPUT_DIR:/output" \
  -e LOCAL_MODE=true \
  video-processor-local \
  node /app/src/local-test.js

echo ""
echo "============================================"
echo " Done! Check output in: $OUTPUT_DIR/"
echo "============================================"
ls -lh "$OUTPUT_DIR/"
