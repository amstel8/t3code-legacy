#!/bin/bash
# Build the fork with our Electron runtime for Monterey.
# Set T3CODE_ELECTRON_DIST to an extracted Electron dist (contains Electron.app and version).
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
export T3CODE_ELECTRON_DIST="${T3CODE_ELECTRON_DIST:-$HOME/.local/t3-build-tools/electron-44.7.2-macos12/dist}"
# Pin the release and checksum together when upgrading our Electron.
ELECTRON_URL="https://github.com/amstel8/legacy-brave-electron-opengl/releases/download/electron-v44.7.2-macos12-x64/electron-v44.7.2-macos12-darwin-x64.zip"
ELECTRON_SHA256="f513ed330cc170a1339ce264db947d7bfaf39dcf726852c92c57bd8025136de7"
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
export npm_config_prefix="$TOOLS/npm-global"
export VP_BIN_DIR="$TOOLS/vp-bin"
export VP_DATA_DIR="$TOOLS/vp-data"
export VP_CACHE_DIR="$TOOLS/vp-cache"
export VP_NODE_MANAGER=no

cd "$REPO"

echo "==> node $(node -v) / pnpm $(pnpm -v)"
echo "==> electron: $(node -p "require('./apps/desktop/node_modules/electron/package.json').version" 2>/dev/null || echo 'не установлен')"

echo "==> pnpm install (custom Electron: $T3CODE_ELECTRON_DIST)"
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
CI=true pnpm install --no-frozen-lockfile

# 1. Validate our runtime; never download the upstream macOS 13 binary.
echo "==> ensure electron runtime"
node apps/desktop/scripts/ensure-electron-runtime.mjs

# 2. Сборка desktop/server/web
echo "==> build:desktop"
RELEASE_VERSION="${T3CODE_VERSION:-$(node -p 'require("./apps/desktop/package.json").version')}"
node scripts/update-release-package-versions.ts "$RELEASE_VERSION"
pnpm build:desktop

# 3. Упаковка. Используем zip, а НЕ dmg:
#    dmg требует assets/dmg/dmg-background-<channel>.png, который генерируется
#    из svg через `sips` — sips не умеет svg, поэтому dmg-шаг падает.
#    В zip лежит тот же .app, он просто не обёрнут в образ диска.
echo "==> packaging zip (arch=x64)"
# This local Monterey build must not inherit an official update feed from CI.
unset GITHUB_REPOSITORY T3CODE_DESKTOP_UPDATE_REPOSITORY
node scripts/build-desktop-artifact.ts --platform mac --target zip --arch x64 --skip-build

# Версия меняется на каждом апстрим-релизе, поэтому берём её из манифеста,
# а не хардкодим в имени файла.
APP_VERSION=$(node -p "require('./apps/desktop/package.json').version")
ZIP="$REPO/release/T3-Code-${APP_VERSION}-x64.zip"
[ -f "$ZIP" ] || { echo "!! артефакт не найден: $ZIP" >&2; exit 1; }

# 4. Локальная сборка не подписана — Electron требует валидную подпись.
#    Подписываем ad-hoc; notarization не нужна, т.к. ставим локально.
STAGE=$(mktemp -d "${TMPDIR:-/tmp}/t3-macos12-stage.XXXXXX")
unzip -q "$ZIP" -d "$STAGE"
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
