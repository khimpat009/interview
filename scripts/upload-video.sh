#!/usr/bin/env bash
# upload-video.sh — Upload an MP4 to the input prefix and trigger processing
set -euo pipefail

VIDEO_PATH="${1:?Usage: ./scripts/upload-video.sh <video-file> [project-name]}"
PROJECT_NAME="${2:-video-processor}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET="${PROJECT_NAME}-${ACCOUNT_ID}-${AWS_REGION}"
FILE_NAME=$(basename "$VIDEO_PATH")

echo "Uploading $FILE_NAME → s3://$BUCKET/input/$FILE_NAME ..."
aws s3 cp "$VIDEO_PATH" "s3://$BUCKET/input/$FILE_NAME" --region "$AWS_REGION"

echo ""
echo "Upload complete. The Lambda will trigger an ECS Fargate task automatically."
echo ""
echo "Monitor progress:"
echo "  aws logs tail /ecs/$PROJECT_NAME --follow --region $AWS_REGION"
echo ""
echo "Check output:"
echo "  aws s3 ls s3://$BUCKET/output/ --region $AWS_REGION"
