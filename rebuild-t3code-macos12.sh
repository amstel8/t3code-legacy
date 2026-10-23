#!/bin/bash
# Build the fork with our Electron runtime for Monterey.
# Set T3CODE_ELECTRON_DIST to an extracted Electron dist (contains Electron.app and version).
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
export T3CODE_ELECTRON_DIST="${T3CODE_ELECTRON_DIST:-$HOME/.local/t3-build-tools/electron-44.9.0-macos12/dist}"
# Pin the release and checksum together when upgrading our Electron.
ELECTRON_URL="https://github.com/amstel8/legacy-brave-electron-opengl/releases/download/electron-v44.9.0-macos12-x64/electron-v44.9.0-macos12-darwin-x64.zip"
ELECTRON_SHA256="7e0be42f00e066d746bb7ab0958ecbe99fa94fb5df97e346b408cc8ae58837e2"
if [ ! -f "$T3CODE_ELECTRON_DIST/version" ]; then
  ELECTRON_CACHE="$(dirname "$T3CODE_ELECTRON_DIST")"
  mkdir -p "$ELECTRON_CACHE"
  ARCHIVE="$ELECTRON_CACHE/dist.zip"
  if [ ! -f "$ARCHIVE" ]; then
    curl -fL --retry 3 "$ELECTRON_URL" -o "$ARCHIVE.part"
    mv "$ARCHIVE.part" "$ARCHIVE"
  fi
  echo "$ELECTRON_SHA256  $ARCHIVE" | shasum -a 256 -c -
  ditto -x -k "$ARCHIVE" "$T3CODE_ELECTRON_DIST"
fi

# Тулчейн (Node 24 + pnpm + vp) живёт в ~/.local/t3-build-tools.
# Симлинки в vp-bin должны быть относительными (../vp-data/current/bin/vp) —
# абсолютные на временную папку opencode уже умирали.
TOOLS="$HOME/.local/t3-build-tools"
[ -d "$TOOLS/node-v24.13.1-darwin-x64" ] || {
  echo "!! тулчейн не найден в $TOOLS" >&2
  echo "   см. AGENTS.macos12.md, раздел «Тулчейн»" >&2
  exit 1
}
[ -x "$TOOLS/vp-bin/vp" ] || {
  echo "!! vp не запускается, симлинки в $TOOLS/vp-bin битые" >&2
  echo "   пересоздай относительные, см. AGENTS.macos12.md" >&2
  exit 1
}

export PATH="$TOOLS/node-v24.13.1-darwin-x64/bin:$TOOLS/npm-global/bin:$TOOLS/vp-bin:/opt/local/bin:$PATH"
# Match the upstream package-manager pin without replacing other projects' pnpm.
PNPM_VERSION=$(node -p 'require(process.argv[1]).packageManager.split("@")[1]' "$REPO/package.json")
LEGACY_PNPM_DIR="$TOOLS/pnpm-$PNPM_VERSION"
if [ ! -x "$LEGACY_PNPM_DIR/node_modules/.bin/pnpm" ]; then
  npm install --prefix "$LEGACY_PNPM_DIR" --no-save "pnpm@$PNPM_VERSION"
fi
export PATH="$LEGACY_PNPM_DIR/node_modules/.bin:$PATH"
export npm_config_prefix="$TOOLS/npm-global"
export VP_BIN_DIR="$TOOLS/vp-bin"
export VP_DATA_DIR="$TOOLS/vp-data"
export VP_CACHE_DIR="$TOOLS/vp-cache"
export VP_NODE_MANAGER=no
# The toolchain uses native Node; do not inherit Electron mode from a T3 agent shell.
unset ELECTRON_RUN_AS_NODE ELECTRON_NO_ASAR

cd "$REPO"

echo "==> node $(node -v) / pnpm $(pnpm -v)"
echo "==> electron: $(node -p "require('./apps/desktop/node_modules/electron/package.json').version" 2>/dev/null || echo 'не установлен')"

echo "==> pnpm install (custom Electron: $T3CODE_ELECTRON_DIST)"
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
CI=true pnpm install --frozen-lockfile

# 1. Validate our runtime; never download the upstream macOS 13 binary.
echo "==> ensure electron runtime"
ELECTRON_EXECUTABLE=$(node apps/desktop/scripts/ensure-electron-runtime.mjs)
for MACHO in "$ELECTRON_EXECUTABLE" "$T3CODE_ELECTRON_DIST/Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework"; do
  MIN_OS=$(otool -l "$MACHO" | awk '$1 == "minos" && !seen++ { print $2 }')
  [ "$MIN_OS" = "12.0" ] || { echo "!! expected macOS 12.0 runtime, got $MIN_OS: $MACHO" >&2; exit 1; }
done
ELECTRON_RUN_AS_NODE=1 "$ELECTRON_EXECUTABLE" -e 'console.log("Runtime:", process.versions.electron, "Node:", process.versions.node)'

# 2. Verify compatibility behavior before producing the distributable.
pnpm verify:legacy

# 3. The canonical packager stamps and restores versions under its build lock.
# ZIP avoids Monterey's sips failing to convert the upstream SVG DMG background.
APP_VERSION="${T3CODE_VERSION:-$(node -p 'require("./apps/desktop/package.json").version')}"
unset GITHUB_REPOSITORY T3CODE_DESKTOP_UPDATE_REPOSITORY
export MACOSX_DEPLOYMENT_TARGET=12.0
node scripts/build-desktop-artifact.ts --platform mac --target zip --arch x64 --build-version "$APP_VERSION"

ZIP="$REPO/release/T3-Code-${APP_VERSION}-x64.zip"
[ -f "$ZIP" ] || { echo "!! артефакт не найден: $ZIP" >&2; exit 1; }

# 4. Локальная сборка не подписана — Electron требует валидную подпись.
#    Подписываем ad-hoc; notarization не нужна, т.к. ставим локально.
STAGE=$(mktemp -d "${TMPDIR:-/tmp}/t3-macos12-stage.XXXXXX")
ditto -x -k "$ZIP" "$STAGE"
APP="$STAGE/T3 Code (Beta).app"

xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
codesign --force --deep --sign - --timestamp=none "$APP"

echo "==> проверка minos"
plutil -p "$APP/Contents/Info.plist" | grep -i LSMinimumSystemVersion
vtool -show-build "$APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework" | grep minos

codesign --verify --deep --strict "$APP"
# Ship the signed app in the final archive, not only in the temporary stage.
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP.signed.zip"
mv "$ZIP.signed.zip" "$ZIP"
# Repacking invalidates the unsigned archive's updater blockmap.
rm -f "$ZIP.blockmap"
(cd "$REPO/release" && shasum -a 256 "$(basename "$ZIP")" > SHA256SUMS.txt)
echo "Готово: $ZIP (версия $APP_VERSION)"
echo "Подписанное приложение: $APP"
