#!/usr/bin/env bash
# check-output.sh — List processed output files and recent ECS tasks
set -euo pipefail

PROJECT_NAME="${1:-video-processor}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET="${PROJECT_NAME}-${ACCOUNT_ID}-${AWS_REGION}"
CLUSTER="${PROJECT_NAME}-cluster"

echo "=== Output files in S3 ==="
aws s3 ls "s3://$BUCKET/output/" --recursive --region "$AWS_REGION" 2>/dev/null || echo "(none yet)"

echo ""
echo "=== Recent ECS tasks ==="
aws ecs list-tasks --cluster "$CLUSTER" --region "$AWS_REGION" \
  --desired-status RUNNING 2>/dev/null || true
aws ecs list-tasks --cluster "$CLUSTER" --region "$AWS_REGION" \
  --desired-status STOPPED --max-items 5 2>/dev/null || true

echo ""
echo "Download all output:"
echo "  aws s3 cp s3://$BUCKET/output/ ./output/ --recursive --region $AWS_REGION"
