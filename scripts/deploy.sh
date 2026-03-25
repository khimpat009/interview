#!/usr/bin/env bash
# deploy.sh — one-command deployment of the Video Processing POC
set -euo pipefail

PROJECT_NAME="${1:-video-processor}"
AWS_REGION="${AWS_REGION:-us-east-1}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo "============================================"
echo " Video Processing POC – Deploy"
echo " Project : $PROJECT_NAME"
echo " Region  : $AWS_REGION"
echo " Account : $ACCOUNT_ID"
echo "============================================"

# ---- Discover default VPC & public subnets ----
VPC_ID=$(aws ec2 describe-vpcs \
  --filters "Name=isDefault,Values=true" \
  --query "Vpcs[0].VpcId" --output text \
  --region "$AWS_REGION")

SUBNET_IDS=$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --query "Subnets[?MapPublicIpOnLaunch==\`true\`].SubnetId" \
  --output text --region "$AWS_REGION")
SUBNET_CSV=$(echo "$SUBNET_IDS" | tr '\t' ',')

echo "VPC     : $VPC_ID"
echo "Subnets : $SUBNET_CSV"
echo ""

# ---- 1. Deploy CloudFormation stack ----
echo ">>> Deploying CloudFormation stack..."
aws cloudformation deploy \
  --template-file infrastructure/cloudformation.yaml \
  --stack-name "$PROJECT_NAME" \
  --parameter-overrides \
      ProjectName="$PROJECT_NAME" \
      VpcId="$VPC_ID" \
      SubnetIds="$SUBNET_CSV" \
  --capabilities CAPABILITY_NAMED_IAM \
  --region "$AWS_REGION"

BUCKET_NAME="${PROJECT_NAME}-${ACCOUNT_ID}-${AWS_REGION}"
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${PROJECT_NAME}"

# ---- 2. Build & push Docker image ----
echo ""
echo ">>> Logging in to ECR..."
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin \
  "${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

echo ">>> Building Docker image (this may take a few minutes)..."
cd container
docker build -t "$PROJECT_NAME" .
docker tag "$PROJECT_NAME:latest" "$ECR_URI:latest"

echo ">>> Pushing image to ECR..."
docker push "$ECR_URI:latest"
cd ..

# ---- Done ----
echo ""
echo "============================================"
echo " Deployment complete!"
echo "============================================"
echo ""
echo "S3 bucket : $BUCKET_NAME"
echo "ECR image : $ECR_URI:latest"
echo ""
echo "Upload a video to start processing:"
echo "  aws s3 cp sample.mp4 s3://$BUCKET_NAME/input/sample.mp4"
echo ""
echo "Monitor logs:"
echo "  aws logs tail /ecs/$PROJECT_NAME --follow --region $AWS_REGION"
echo ""
echo "Check output:"
echo "  aws s3 ls s3://$BUCKET_NAME/output/"
