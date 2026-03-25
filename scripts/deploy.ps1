# deploy.ps1 — Deploy the Video Processing POC to AWS
# Prerequisites: AWS CLI configured, Docker Desktop running
param(
    [string]$ProjectName = "video-processor",
    [string]$Region = "us-east-1"
)

$ErrorActionPreference = "Stop"

# Get AWS Account ID
$AccountId = aws sts get-caller-identity --query Account --output text
if ($LASTEXITCODE -ne 0) { throw "AWS CLI not configured. Run 'aws configure' first." }

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " Video Processing POC - Deploy"
Write-Host " Project : $ProjectName"
Write-Host " Region  : $Region"
Write-Host " Account : $AccountId"
Write-Host "============================================" -ForegroundColor Cyan

# ---- Discover default VPC & public subnets ----
$VpcId = aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text --region $Region
if (-not $VpcId -or $VpcId -eq "None") { throw "No default VPC found in $Region. Create one or specify VpcId manually." }

$SubnetIds = aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VpcId" --query "Subnets[?MapPublicIpOnLaunch==``true``].SubnetId" --output text --region $Region
$SubnetCsv = ($SubnetIds -split "`t") -join ","
if (-not $SubnetCsv) { throw "No public subnets found in VPC $VpcId." }

Write-Host "VPC     : $VpcId"
Write-Host "Subnets : $SubnetCsv"
Write-Host ""

# ---- 1. Deploy CloudFormation stack ----
Write-Host ">>> Deploying CloudFormation stack..." -ForegroundColor Yellow
aws cloudformation deploy `
    --template-file infrastructure/cloudformation.yaml `
    --stack-name $ProjectName `
    --parameter-overrides `
        "ProjectName=$ProjectName" `
        "VpcId=$VpcId" `
        "SubnetIds=$SubnetCsv" `
    --capabilities CAPABILITY_NAMED_IAM `
    --region $Region

if ($LASTEXITCODE -ne 0) { throw "CloudFormation deployment failed." }

$BucketName = "$ProjectName-$AccountId-$Region"
$EcrUri = "$AccountId.dkr.ecr.$Region.amazonaws.com/$ProjectName"

# ---- 2. Build & push Docker image ----
Write-Host ""
Write-Host ">>> Logging in to ECR..." -ForegroundColor Yellow
$ecrPassword = aws ecr get-login-password --region $Region
$ecrPassword | docker login --username AWS --password-stdin "$AccountId.dkr.ecr.$Region.amazonaws.com"

Write-Host ">>> Building Docker image..." -ForegroundColor Yellow
Push-Location container
docker build -t $ProjectName .
docker tag "${ProjectName}:latest" "${EcrUri}:latest"

Write-Host ">>> Pushing image to ECR..." -ForegroundColor Yellow
docker push "${EcrUri}:latest"
Pop-Location

# ---- Done ----
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host " Deployment complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "S3 bucket : $BucketName"
Write-Host "ECR image : ${EcrUri}:latest"
Write-Host ""
Write-Host "Upload a video to start processing:"
Write-Host "  aws s3 cp .\your-video.mp4 s3://$BucketName/input/your-video.mp4" -ForegroundColor White
Write-Host ""
Write-Host "Monitor logs:"
Write-Host "  aws logs tail /ecs/$ProjectName --follow --region $Region" -ForegroundColor White
Write-Host ""
Write-Host "Check output:"
Write-Host "  aws s3 ls s3://$BucketName/output/" -ForegroundColor White
Write-Host ""
Write-Host "Download output:"
Write-Host "  aws s3 cp s3://$BucketName/output/ .\output\ --recursive --region $Region" -ForegroundColor White
