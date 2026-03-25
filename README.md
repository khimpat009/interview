# Video Processing POC — Detection & Masking on AWS

Automated pipeline that detects **people** and **vehicle license plates** in MP4 videos, applies blur masking, and outputs a processed video with a JSON detection report.

## Architecture

```
S3 (input/)  ──▶  Lambda (orchestrator)  ──▶  ECS Fargate (container)
                                                    │
                                           Node.js + YOLOv8 + FFmpeg
                                                    │
                                              S3 (output/)
                                           video.mp4 + detections.json
```

| Component | Purpose |
|-----------|---------|
| **Amazon S3** | Stores input videos (`input/`) and results (`output/`) |
| **AWS Lambda** | Orchestration only — receives S3 event, starts Fargate task |
| **ECS Fargate** | Runs the container that performs all video processing |
| **Node.js** | Application runtime (Lambda + container) |
| **YOLOv8 (ONNX)** | Object detection — people & vehicles |
| **FFmpeg** | Frame extraction and video reassembly |
| **sharp** | Per-frame Gaussian blur on detected regions |

## How It Works

1. Upload an MP4 to `s3://<bucket>/input/`
2. S3 notification triggers the Lambda orchestrator
3. Lambda starts an ECS Fargate task, passing the S3 location as env vars
4. The container downloads the video, extracts every frame via FFmpeg
5. YOLOv8n detects **person** and **vehicle** classes per frame
6. License-plate regions are estimated within each vehicle bounding box
7. All detected regions are blurred with sharp (Gaussian σ = 25)
8. FFmpeg reassembles the processed frames (+ original audio) into the output video
9. Both the masked video and a `_detections.json` file are uploaded to `s3://<bucket>/output/`

## Prerequisites

- **AWS CLI** v2 configured with credentials (`aws configure`)
- **Docker** installed and running
- **Bash** shell (Linux / macOS / WSL)

## Setup & Deployment

```bash
git clone <repository-url>
cd video-processor

# Deploy everything (CloudFormation + Docker build + ECR push)
chmod +x scripts/*.sh
./scripts/deploy.sh              # uses default project name "video-processor"
# or
./scripts/deploy.sh my-project   # custom prefix
```

The deploy script will:
1. Find your default VPC and public subnets
2. Create/update a CloudFormation stack (S3, ECR, ECS, IAM, Lambda)
3. Build the container image (includes YOLOv8n model export)
4. Push the image to ECR

## Running

```bash
# Upload a video — processing starts automatically
./scripts/upload-video.sh sample.mp4

# Watch container logs
aws logs tail /ecs/video-processor --follow

# Check output
./scripts/check-output.sh

# Download results
aws s3 cp s3://<bucket>/output/ ./output/ --recursive
```

## Project Structure

```
├── infrastructure/
│   └── cloudformation.yaml      # All AWS resources (S3, Lambda, ECS, IAM)
├── lambda/
│   ├── index.js                 # Orchestrator — S3 event → ECS RunTask
│   └── package.json
├── container/
│   ├── Dockerfile               # Multi-stage: YOLO export → Node.js runtime
│   ├── package.json
│   └── src/
│       ├── index.js             # Entry point
│       ├── config.js            # Reads environment variables
│       ├── s3-client.js         # S3 download / upload helpers
│       ├── detector.js          # YOLOv8 ONNX inference + NMS
│       └── video-processor.js   # FFmpeg frames + sharp blur pipeline
├── scripts/
│   ├── deploy.sh                # Full deployment automation
│   ├── upload-video.sh          # Upload video to trigger processing
│   └── check-output.sh          # List outputs and ECS task status
└── README.md
```

## Sample Video

The sample input video can be downloaded from:  
https://drive.google.com/drive/folders/1ybEvCme6aq5vFeiOxvWjNw-5Zu1w53DO?usp=drive_link

## Output

- **`output/<name>.mp4`** — Video with blurred people and license-plate regions
- **`output/<name>_detections.json`** — Per-frame bounding boxes, class labels, confidence scores
