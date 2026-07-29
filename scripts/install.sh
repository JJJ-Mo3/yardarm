#!/bin/sh
# Installs (or updates) Yardarm from the latest GitHub release:
#
#   curl -fsSL https://raw.githubusercontent.com/JJJ-Mo3/yardarm/main/scripts/install.sh | sh
#
# Why a script: release builds are unsigned, so a browser-downloaded copy gets
# the com.apple.quarantine attribute and Gatekeeper refuses to open it
# ("Yardarm is damaged and can't be opened" — with no bypass on macOS 15+).
# curl downloads carry no quarantine attribute, so an app installed this way
# opens normally.
set -eu

REPO="JJJ-Mo3/yardarm"
DEST="/Applications/Yardarm.app"

if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  echo "Yardarm releases are built for macOS on Apple Silicon (arm64) only." >&2
  echo "On other platforms, build from source: https://github.com/$REPO#from-source-all-platforms" >&2
  exit 1
fi

echo "Looking up the latest Yardarm release..."
url=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" |
  grep -o '"browser_download_url"[^"]*"[^"]*-arm64\.zip"' |
  grep -o 'https[^"]*' | head -n 1)

if [ -z "$url" ]; then
  echo "Could not find a macOS arm64 zip asset on the latest release." >&2
  echo "Check https://github.com/$REPO/releases manually." >&2
  exit 1
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "Downloading ${url##*/} ..."
curl -fL --progress-bar "$url" -o "$tmp/yardarm.zip"

echo "Extracting..."
ditto -x -k "$tmp/yardarm.zip" "$tmp/extract"
app=$(find "$tmp/extract" -maxdepth 1 -name '*.app' | head -n 1)
if [ -z "$app" ]; then
  echo "The release zip did not contain an .app bundle." >&2
  exit 1
fi

if [ -d "$DEST" ]; then
  echo "Replacing the existing $DEST ..."
  osascript -e 'tell application "Yardarm" to quit' >/dev/null 2>&1 || true
  sleep 1
  rm -rf "$DEST"
fi

echo "Installing to $DEST ..."
ditto "$app" "$DEST"
# Belt and braces — a no-op for curl downloads, which are never quarantined.
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

version=$(defaults read "$DEST/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo "")
echo "Installed Yardarm${version:+ $version}."
open "$DEST"
