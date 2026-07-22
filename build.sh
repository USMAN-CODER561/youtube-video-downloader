#!/usr/bin/env bash
set -euo pipefail

echo "========================================"
echo " Build Script for yt-dlp-downloader"
echo "========================================"

# Create bin directory for local binaries
mkdir -p bin

# ──────────────────────────────────────────────
#  1) Download static ffmpeg build (Linux x86_64)
# ──────────────────────────────────────────────
FFMPEG_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
FFMPEG_TAR="ffmpeg-release-amd64-static.tar.xz"

echo "[build] Downloading ffmpeg static build from johnvansickle.com..."
if curl -sL "$FFMPEG_URL" -o "$FFMPEG_TAR"; then
    echo "[build] Extracting ffmpeg..."
    tar -xf "$FFMPEG_TAR" --strip-components=1 -C ./bin/ --wildcards '*/ffmpeg' 2>/dev/null || \
    tar -xf "$FFMPEG_TAR" --strip-components=1 -C ./bin/ '*/ffmpeg' 2>/dev/null || {
        # If the above fails, try to find and copy the binary manually
        EXTRACT_DIR=$(tar -tf "$FFMPEG_TAR" | head -1 | cut -d/ -f1)
        tar -xf "$FFMPEG_TAR"
        cp "$EXTRACT_DIR/ffmpeg" ./bin/ffmpeg
        chmod +x ./bin/ffmpeg
        rm -rf "$EXTRACT_DIR"
    }
    chmod +x ./bin/ffmpeg 2>/dev/null || true
    rm -f "$FFMPEG_TAR"
    echo "[build] ffmpeg installed at $(pwd)/bin/ffmpeg"
else
    echo "[build] ERROR: Failed to download ffmpeg from $FFMPEG_URL"
    exit 1
fi

# ──────────────────────────────────────────────
#  2) Download yt-dlp binary
# ──────────────────────────────────────────────
YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"

echo "[build] Downloading yt-dlp from GitHub..."
if curl -sL "$YTDLP_URL" -o bin/yt-dlp; then
    chmod +x bin/yt-dlp
    echo "[build] yt-dlp installed at $(pwd)/bin/yt-dlp"
else
    echo "[build] ERROR: Failed to download yt-dlp from $YTDLP_URL"
    exit 1
fi

# ──────────────────────────────────────────────
#  3) Download Deno binary (for JS runtime / YouTube signature solving)
# ──────────────────────────────────────────────
DENO_URL="https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip"
DENO_ZIP="deno-x86_64-unknown-linux-gnu.zip"
DENO_BIN="./bin/deno"

if [ ! -f "$DENO_BIN" ]; then
    echo "[build] Downloading Deno static binary from GitHub..."
    if curl -sL "$DENO_URL" -o "$DENO_ZIP"; then
        unzip -o "$DENO_ZIP" -d ./bin/ > /dev/null 2>&1
        chmod +x "$DENO_BIN"
        rm -f "$DENO_ZIP"
        echo "[build] Deno installed at $(pwd)/bin/deno"
    else
        echo "[build] ERROR: Failed to download Deno from $DENO_URL"
        exit 1
    fi
else
    echo "[build] Deno binary already exists, skipping download."
fi

# ──────────────────────────────────────────────
#  4) Verify installations
# ──────────────────────────────────────────────
echo ""
echo "[build] === Verification ==="
echo "  yt-dlp version: $(./bin/yt-dlp --version 2>&1)"
echo "  ffmpeg version: $(./bin/ffmpeg -version 2>&1 | head -n1)"
if [ -f "$DENO_BIN" ]; then
    echo "  deno version: $(./bin/deno --version 2>&1 | head -n1)"
else
    echo "  deno: NOT INSTALLED"
fi
echo ""

# The binaries are now in ./bin/ relative to the project root.
# These persist into runtime on Render (same filesystem).
echo "[build] Binaries installed successfully in $(pwd)/bin/"

# ──────────────────────────────────────────────
#  5) Install npm dependencies
# ──────────────────────────────────────────────
echo "[build] Installing npm dependencies..."
npm install --production

echo "[build] Build complete!"

