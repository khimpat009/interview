# test-local.ps1 — Run the video processing pipeline locally with Docker
# Usage: .\scripts\test-local.ps1 -VideoPath "C:\path\to\video.mp4"
param(
    [Parameter(Mandatory=$true)]
    [string]$VideoPath
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $VideoPath)) {
    Write-Error "File not found: $VideoPath"
    exit 1
}

$AbsVideoPath = (Resolve-Path $VideoPath).Path
$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$OutputDir = Join-Path $ProjectDir "output"

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

Write-Host "============================================"
Write-Host " Local Test - Video Processing POC"
Write-Host " Input : $AbsVideoPath"
Write-Host " Output: $OutputDir\"
Write-Host "============================================"
Write-Host ""

# Build the container
Write-Host ">>> Building Docker image (first build downloads YOLOv8n model - may take a few minutes)..."
docker build -t video-processor-local "$ProjectDir\container"
if ($LASTEXITCODE -ne 0) { Write-Error "Docker build failed"; exit 1 }

# Convert Windows paths to Docker-compatible format
$DockerVideo = $AbsVideoPath -replace '\\','/' -replace '^([A-Za-z]):','/$1'
$DockerOutput = $OutputDir -replace '\\','/' -replace '^([A-Za-z]):','/$1'

Write-Host ""
Write-Host ">>> Running video processing..."
docker run --rm `
    -v "${DockerVideo}:/tmp/work/input.mp4:ro" `
    -v "${DockerOutput}:/output" `
    -e LOCAL_MODE=true `
    video-processor-local `
    node /app/src/local-test.js

if ($LASTEXITCODE -ne 0) { Write-Error "Processing failed"; exit 1 }

Write-Host ""
Write-Host "============================================"
Write-Host " Done! Check output in: $OutputDir\"
Write-Host "============================================"
Get-ChildItem $OutputDir | Format-Table Name, Length, LastWriteTime
