# Video Processing POC

Blurs faces and license plates in video files. Runs on AWS using S3, Lambda, and ECS Fargate.

## Overview

When you upload an MP4 to S3, a Lambda function picks it up and spins up a Fargate container. The container pulls the video, runs YOLOv8 to find people and vehicles, estimates where the faces and plates are, blurs those areas, and writes the result back to S3.

A simple tracker keeps faces blurred between frames — if someone is walking and YOLO misses a frame (or you skip frames for speed), the tracker predicts where the face moved based on velocity.

```
S3 (input/)  →  Lambda  →  ECS Fargate (Node.js + YOLOv8 + FFmpeg)  →  S3 (output/)
```

## How it works

1. Drop an MP4 into `s3://<bucket>/input/`
2. S3 event triggers Lambda, which starts a Fargate task
3. Container downloads the video and extracts frames with FFmpeg
4. YOLOv8n runs on every Nth frame (configurable) to detect people and vehicles
5. Face regions are estimated from person bounding boxes, plates from vehicle boxes
6. Tracker follows faces across frames using IoU matching + velocity prediction
7. Detected regions get a Gaussian blur via sharp
8. FFmpeg stitches frames back together (keeps original audio)
9. Output video + detection JSON uploaded to `s3://<bucket>/output/`

## Configuration

| Variable | Default | What it does |
|----------|---------|-------------|
| `CONFIDENCE_THRESHOLD` | `0.4` | Min detection confidence |
| `BLUR_SIGMA` | `25` | Blur strength |
| `DETECT_INTERVAL` | `1` | Run YOLO every N frames. Set to 3 or 5 to speed things up |
| `MODEL_PATH` | `/app/models/yolov8n.onnx` | ONNX model path inside the container |

## Prerequisites

- AWS CLI v2 (run `aws configure` first)
- Docker
- Bash (Linux/macOS/WSL) or PowerShell (Windows)

## Deploy

```bash
git clone <repository-url>
cd video-processor

chmod +x scripts/*.sh
./scripts/deploy.sh                # default name: "video-processor"
./scripts/deploy.sh my-project     # or use a custom name
```

On Windows:
```powershell
.\scripts\deploy.ps1 -ProjectName "video-processor" -Region "us-east-1"
```

This creates the CloudFormation stack, builds the Docker image (exports the YOLOv8n model during build), and pushes it to ECR.

## Usage

```bash
# upload a video — processing kicks off automatically
./scripts/upload-video.sh sample.mp4

# tail the logs
aws logs tail /ecs/video-processor --follow

# check what's in the output bucket
./scripts/check-output.sh

# pull results locally
aws s3 cp s3://<bucket>/output/ ./output/ --recursive
```

Local testing (no AWS needed):
```powershell
.\scripts\test-local.ps1 -VideoPath "C:\path\to\video.mp4"
```

## Project structure

```
infrastructure/
  cloudformation.yaml        # S3, Lambda, ECS, IAM — everything
lambda/
  index.js                   # Orchestrator: S3 event → ECS RunTask
  package.json
container/
  Dockerfile                 # Stage 1: export YOLO model, Stage 2: Node.js + FFmpeg
  package.json
  src/
    index.js                 # Entry point (AWS mode)
    local-test.js            # Entry point (local Docker testing)
    config.js                # Env var config
    s3-client.js             # S3 upload/download
    detector.js              # YOLOv8 inference, NMS, face & plate region estimation
    tracker.js               # IoU tracker with velocity prediction
    video-processor.js       # Frame extraction, blur, reassembly
scripts/
  deploy.sh / deploy.ps1     # Deploy to AWS
  test-local.ps1 / test-local.sh  # Run locally with Docker
  upload-video.sh            # Upload video to S3
  check-output.sh            # Check output bucket / task status
```

## Sample video

https://drive.google.com/drive/folders/1ybEvCme6aq5vFeiOxvWjNw-5Zu1w53DO?usp=drive_link

## Output

- `output/<name>.mp4` — blurred video
- `output/<name>_detections.json` — per-frame detection data (bounding boxes, class, confidence, track IDs)
