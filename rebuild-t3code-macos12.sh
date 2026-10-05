#!/bin/bash
# Пересборка T3 Code с Electron 43.x, работающего на macOS 12 (Monterey).
#
# Почему так: Electron 44+ собран под macOS 13 (minos 13.0) и на Monterey
# не запускается. Electron 43.x имеет minos 12.0, и это навсегда: Electron
# режет поддержку ОС на мажорных ветках, так что 43.x — последняя линия
# под macOS 12 и дальше она не двинется. Проверено на 43.0.0 и 43.7.7.
# Подтверждено также тем, что в теге v0.0.40 репозитория был electron 43.4.1.
#
# Подробности, диагностика и подводные камни: AGENTS.macos12.md
#
# Использование:  ./rebuild-t3code-macos12.sh
set -euo pipefail

REPO="$HOME/Documents/fan/t3code"

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

# 0. Зависимости. --no-frozen-lockfile обязателен: пин Electron расходится с
#    upstream-lock, иначе pnpm падает с ERR_PNPM_OUTDATED_LOCKFILE.
#    CI=true нужен, чтобы pnpm согласился пересоздать node_modules без TTY.
#    electron в apps/desktop/package.json должен быть 43.x — проверяем.
echo "==> pnpm install"
node -e "
  const v = require('./apps/desktop/package.json').dependencies.electron;
  if (!v.startsWith('43.')) { console.error('!! electron=' + v + ', ожидался 43.x'); process.exit(1); }
  console.log('==> electron: ' + v);
"
CI=true pnpm install --no-frozen-lockfile

# 1. Нативные модули (node-pty и др.) должны быть пересобраны под ABI Electron 43
echo "==> ensure electron runtime"
node apps/desktop/scripts/ensure-electron-runtime.mjs

# 2. Сборка desktop/server/web
echo "==> build:desktop"
pnpm build:desktop

# 3. Упаковка. Используем zip, а НЕ dmg:
#    dmg требует assets/dmg/dmg-background-<channel>.png, который генерируется
#    из svg через `sips` — sips не умеет svg, поэтому dmg-шаг падает.
#    В zip лежит тот же .app, он просто не обёрнут в образ диска.
echo "==> packaging zip (arch=x64)"
node scripts/build-desktop-artifact.ts --platform mac --target zip --arch x64

# Версия меняется на каждом апстрим-релизе, поэтому берём её из манифеста,
# а не хардкодим в имени файла.
APP_VERSION=$(node -p "require('./apps/desktop/package.json').version")
ZIP="$REPO/release/T3-Code-${APP_VERSION}-x64.zip"
[ -f "$ZIP" ] || { echo "!! артефакт не найден: $ZIP" >&2; exit 1; }

# 4. Локальная сборка не подписана — Electron требует валидную подпись.
#    Подписываем ad-hoc; notarization не нужна, т.к. ставим локально.
STAGE="${TMPDIR:-/tmp}/t3-macos12-stage"
rm -rf "$STAGE" && mkdir -p "$STAGE"
unzip -q "$ZIP" -d "$STAGE"
APP="$STAGE/T3 Code (Alpha).app"

xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
codesign --force --deep --sign - --timestamp=none "$APP"

echo "==> проверка minos"
plutil -p "$APP/Contents/Info.plist" | grep -i LSMinimumSystemVersion
vtool -show-build "$APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework" | grep minos

echo
echo "Готово: $APP  (версия $APP_VERSION)"
echo
echo "Установка — по PID, а не по шаблону (правило 1 в upstream AGENTS.md):"
echo "  PID=\$(ps -Ao pid=,command= | grep -F 'Applications/T3 Code' | grep -v grep | head -1 | awk '{print \$1}')"
echo "  [ -n \"\$PID\" ] && kill \"\$PID\""
echo "  rm -rf '/Applications/T3 Code (Alpha).app'"
echo "  cp -R '$APP' '/Applications/T3 Code (Alpha).app'"
echo "  open -a '/Applications/T3 Code (Alpha).app'"
echo
echo "Не используй pkill -f 'T3 Code': в имени есть скобки (Alpha), которые"
echo "pgrep/pkill читают как regex-группу, и команда молча ничего не находит."
echo
echo "Автообновление отключено само: в локальной сборке нет Resources/app-update.yml,"
echo "поэтому hasUpdateFeedConfig=false и shouldEnableAutoUpdates=false."
echo "Не копируй app-update.yml из официального релиза — иначе апдейт снова"
echo "притащит сборку под macOS 13 и приложение перестанет запускаться."
