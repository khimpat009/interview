# ---- Stage 1: export YOLOv8n to ONNX ----
FROM python:3.11-slim AS model-export

WORKDIR /export
RUN apt-get update && \
    apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libxcb1 && \
    rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir ultralytics
RUN python -c "\
from ultralytics import YOLO; \
model = YOLO('yolov8n.pt'); \
model.export(format='onnx', imgsz=640) \
"

# ---- Stage 2: Node.js runtime ----
FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy ONNX model from build stage
COPY --from=model-export /export/yolov8n.onnx ./models/yolov8n.onnx

# Install Node.js dependencies
COPY package.json ./
RUN npm install --omit=dev

# Copy application source
COPY src/ ./src/

CMD ["node", "src/index.js"]
