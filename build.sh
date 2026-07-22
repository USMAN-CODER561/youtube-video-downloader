#!/usr/bin/env bash
set -euo pipefail

echo "========================================"
echo " Build Script for yt-dlp-downloader"
echo "========================================"

# Install system dependencies for ffmpeg
echo "[build] Installing ffmpeg via apt-get..."
apt-get update -qq
apt-get install -y -qq ffmpeg
echo "[build] ffmpeg installed successfully"

# Create bin directory
mkdir -p bin

# Download yt-dlp binary
echo "[build] Downloading yt-dlp..."
YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
curl -sL "$YTDLP_URL" -o bin/yt-dlp
chmod +x bin/yt-dlp
echo "[build] yt-dlp downloaded to $(pwd)/bin/yt-dlp"

# Verify installations
echo "[build] Verifying installations..."
echo "  yt-dlp version: $(./bin/yt-dlp --version 2>&1)"
echo "  ffmpeg version: $(ffmpeg -version 2>&1 | head -n1)"

echo "[build] Installing npm dependencies..."
npm install --production

echo "[build] Build complete!"

