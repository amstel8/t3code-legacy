# Сборка T3 Code под macOS 12 (Monterey)

Локальная инструкция для этой машины. Не заменяет upstream `AGENTS.md` — тот
описывает разработку в репозитории, этот файл про то, как собрать и запустить
приложение **здесь**, на Intel Mac Pro.

Upstream-релизы T3 Code на этой системе **не запускаются**. Это не настройка,
не поломка установки, и не чинится переустановкой.

---

## Коротко

|                 |                                                        |
| --------------- | ------------------------------------------------------ |
| Система         | macOS 12.7.6 (Monterey), build 21H1320                 |
| Железо          | Mac Pro `MacPro5,1` (2010), Intel Xeon X5690, `x86_64` |
| Что не работает | официальные сборки 0.0.41+ и новее                     |
| Рабочее решение | `electron@43.7.7` вместо `44.4.2`                      |
| Собирается      | `0.0.45` — вся свежая функциональность, не откат       |

Проверено: собранная 0.0.45 живёт на Monterey, окно рисуется, backend отвечает.

---

## Почему официальные сборки не запускаются

Electron 44 собран под macOS 13. Это видно на трёх уровнях, и все три надо
учитывать при диагностике:

1. `Contents/Info.plist` → `LSMinimumSystemVersion: 13.0`
2. `Electron Framework.framework` → Mach-O `LC_BUILD_VERSION` с `minos 13.0`
3. Реальный вызов macOS 13 API: `SMAppService` (`ServiceManagement`)

Пункты 1 и 2 — это то, о чём сообщает LaunchServices:
`kLSIncompatibleSystemVersionErr: The app cannot run on the current OS version`.
Пункт 3 — причина, по которой **простое понижение `minos` не помогает**.

### Правка `minos` вручную — не решение

Понизить `minos` 13.0 → 12.0 через `vtool`, поправить `Info.plist` и
переподписать ad-hoc можно, и ShipIt тогда перестанет ругаться. Приложение
дойдёт до `dyld` и упадёт:

```
dyld: Symbol not found: (_OBJC_CLASS_$_SMAppService)
```

Дальше по списку идут и другие 13+ API. Объём проверен: около 2578 undefined
символов в `Electron Framework`, отсутствуют не один десяток. Символы вроде
`SMAppService`, `UTType*` в Electron 43.x присутствуют как **weak-import**,
поэтому 43.x на Monterey и грузится, а 44.x — нет.

Не тратьте время на shim-библиотеки. Правильный путь — подменить Electron.

---

## Правка репозитория

Две строки, в `main`. Всё остальное совпадает с upstream.

**`apps/desktop/package.json`**

```diff
-    "electron": "44.4.2",
+    "electron": "43.7.7",
```

**`pnpm-workspace.yaml`** — в списке `minimumReleaseAgeExclude`:

```diff
-  - electron@44.4.2
+  - electron@43.7.7
```

`pnpm-lock.yaml` пересоберется сам при установке, руками не трогать.

### Почему 43.x, а не «просто 44»

Это не подставленная наугад цифра. В теге `v0.0.40` репозитория стоял
`electron: 43.4.1`, и релиз 0.0.40 — последний с `minos 12.0`, то есть
официально рабочий на Monterey. Проверено, что 43.4.1, 43.7.3 и 43.7.7 имеют
`minos 12.0`.

| Версия         | Дата      | `minOS`  | `minos` Electron |
| -------------- | --------- | -------- | ---------------- |
| 0.0.39         | 07.09     | 12.0     | —                |
| **0.0.40**     | **08.09** | **12.0** | **12.0**         |
| 0.0.41-preview | 13.09     | 13.0     | —                |
| 0.0.42         | 16.09     | 13.0     | 13.0             |
| 0.0.43+        | 23.09+    | 13.0     | 13.0             |

### 43.x — навсегда на macOS 12

Поддержку ОС Electron режет **на мажорных ветках**, а не в патчах. 43.x —
последняя линия с `minos 12.0`; 44.x и дальше требуют 13.0. Значит 43.x
уходит в EOL и новых релизов в ней не будет, а `minos` уже выпущенных
билдов не меняется задним числом.

**Проверено на обоих концах линейки:** и 43.0.0, и 43.7.7 дают
`LSMinimumSystemVersion 12.0` и Mach-O `minos 12.0`.

Практический вывод: пин `43.x` не нужно пересматривать при каждом обновлении
T3 Code, он не «протухнет». Апстрим может поднять `electron` и на 44, и на 45 —
форк просто не мержит эту строку, а ставит последний 43.x.

Единственное, за чем стоит следить: **последний** 43.x. Он получает багфиксы
Chromium, пока ветка жива, поэтому обновляйтесь в пределах 43.x (`43.7.7` на
момент проверки, `43-x-y` в npm), а не застревайте на 43.4.1.

Проверять `minos` руками нужно только если версия не из линейки 43.x:

```bash
# быстрая проверка любого кандидата, до установки в репо
curl -sL -o /tmp/e.zip \
  https://github.com/electron/electron/releases/download/v<VERSION>/electron-v<VERSION>-darwin-x64.zip
unzip -q -o /tmp/e.zip -d /tmp/e
plutil -p /tmp/e/Electron.app/Contents/Info.plist | grep -i minimumsystem
vtool -show-build "/tmp/e/Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework" | grep minos
```

---

## Тулчейн

Репо требует `node ^24.13.1` и `pnpm@11.10.0`. Системный Node здесь 22, pnpm
и `vp` не установлены — так что тулчейн стоит **изолированно**, глобальную
систему не трогаем.

```bash
TOOLS="$HOME/.local/t3-build-tools"        # см. «Куда перенести тулчейн»
export PATH="$TOOLS/node-v24.13.1-darwin-x64/bin:$TOOLS/npm-global/bin:$TOOLS/vp-bin:$PATH"
export npm_config_prefix="$TOOLS/npm-global"

# Node 24
curl -sSL -o /tmp/node24.tar.gz \
  https://nodejs.org/dist/v24.13.1/node-v24.13.1-darwin-x64.tar.gz
tar xzf /tmp/node24.tar.gz -C "$TOOLS"

# pnpm
"$TOOLS/node-v24.13.1-darwin-x64/bin/npm" i -g pnpm@11.10.0

# vp (Vite+). Установщик требует VP_BIN_DIR, VP_DATA_DIR и VP_CACHE_DIR все три сразу.
VP_BIN_DIR="$TOOLS/vp-bin" VP_DATA_DIR="$TOOLS/vp-data" \
  VP_CACHE_DIR="$TOOLS/vp-cache" VP_NODE_MANAGER=no \
  bash -c 'curl -fsSL https://vite.plus | bash'
```

Rust из Homebrew (`/opt/local/bin`) — версии 1.98.1, target
`x86_64-apple-darwin` есть. Нужен для `t3-resource-monitor`; нативная
кросс-сборка не требуется, железка и так Intel.

---

## Сборка

```bash
cd ~/Documents/fan/t3code

pnpm install --no-frozen-lockfile                # ~2.5 мин, пересобирает lock под 43.7.7
node apps/desktop/scripts/ensure-electron-runtime.mjs
pnpm build:desktop                               # desktop + server + web
node scripts/build-desktop-artifact.ts --platform mac --target zip --arch x64
```

Артефакт: `release/T3-Code-0.0.45-x64.zip`

**`--no-frozen-lockfile` обязателен.** Пин Electron расходится с
upstream-lock, поэтому `pnpm install` без флага падает с
`ERR_PNPM_OUTDATED_LOCKFILE`. На не-TTY ещё нужен `CI=true`, иначе pnpm
откажется пересоздавать `node_modules` (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`).

Перед `pnpm install` разумно прогнать `git checkout -- apps/desktop/package.json
pnpm-lock.yaml`, а после — вернуть пин: апстрим тянет за собой и lock, и
манифест, и их надо патчить заново.

### Обязательные нюансы

**Только `--target zip`, не `dmg`.** DMG-шаг падает:

```
cannot find specified resource "dmg/dmg-background-latest.png"
```

Скрипт конвертирует `apps/desktop/resources/dmg/dmg-background-latest.svg` в
png через `sips`, а `sips` не умеет SVG. Это баг в репозитории, не на этой
машине. В zip лежит тот же `.app` — он просто не обёрнут в образ диска. Если
нужен именно `.dmg`, сначала сконвертируйте svg в png самостоятельно (`qlmanage`,
`rsvg-convert` или Inkscape) и положите результат в `apps/desktop/resources/dmg/`.

**`ensure-electron-runtime.mjs` обязателен.** После `pnpm install` в
`node_modules/electron` лежит только заглушка: `dist/` пуст, `path.txt` может
быть не заполнен. Скрипт докладывает бинарник. Без него упадёт сборка.

**Нативные модули собираются под ABI автоматически.** В шаге упаковки
`build-desktop-artifact.ts` вызывается `@electron/rebuild` с
`electronVersion=43.7.7` (берётся из `apps/desktop/package.json`, руками
задавать не надо) и пересобирает `node-pty`. Отдельно ничего делать не
нужно, руками ABI трогать не надо.

**Не запускайте `vp run -r test` / `vp check`.** Это противоречит правилу
upstream `AGENTS.md` («Do not run repo-wide checks»).

---

## Подпись и установка

Electron отказывается стартовать без валидной подписи. Локальная сборка не
подписана, а notarization невозможна без аккаунта разработчика — достаточно
ad-hoc. Всег�� два шага:

```bash
STAGE=/tmp/t3-stage
rm -rf "$STAGE" && mkdir -p "$STAGE"
unzip -q release/T3-Code-0.0.45-x64.zip -d "$STAGE"
APP="$STAGE/T3 Code (Alpha).app"

xattr -dr com.apple.quarantine "$APP"
codesign --force --deep --sign - --timestamp=none "$APP"
codesign -v "$APP"          # должно быть без ошибок
```

Перед заменой в `/Applications` закройте работающее приложение **по PID**,
а не по шаблону (правило 1 в upstream `AGENTS.md`):

```bash
pkill -f 'Applications/T3 Code'   # ⛔ так не надо, см. «Подводные камни»
```

```bash
# правильно: сначала PID, потом kill именно его
pgrep -f "Applications/T3 Code" | head -1     # запомнить PID
kill <тот PID>                                # и только его
```

```bash
cp -R "$APP" "/Applications/T3 Code (Alpha).app"
open -a "/Applications/T3 Code (Alpha).app"
```

Данные не теряются: `~/.t3/userdata` (чаты, настройки, `state.sqlite`) лежит
отдельно от бандла и переживает замену `.app`.

---

## Автообновление

Отключено **само собой**, и это надо понимать, чтобы не сломать руками.

В локальной сборке нет `Contents/Resources/app-update.yml` — его генерирует
релизный CI. Дальше по коду (`apps/desktop/src/updates/DesktopUpdates.ts`):

```
hasUpdateFeedConfig = false
  → getAutoUpdateDisabledReason() → "no update feed is configured"
  → shouldEnableAutoUpdates = false
  → updaterConfiguredRef = false, autoDownload не вызывается
```

**Не копируйте `app-update.yml` из официального релиза.** Это единственный
способ уронить эту сборку: feed появится, апдейт притащит 0.0.43+ с
`minos 13.0`, и приложение перестанет запускаться — то самое, от чего мы
уходили. Если нужен ручной апдейт, качайте zip и ставьте по инструкции выше.

Осторожнее с `--mock-updates` в `build-desktop-artifact.ts`: он тоже генерирует
`app-update.yml`. Не используйте его на Monterey.

Альтернатива на будущее, если понадобится: `T3CODE_DISABLE_AUTO_UPDATE=1`
(env, читается в `apps/desktop/src/app/DesktopConfig.ts`).

---

## Проверка

Порядок проверок — от дешёвой к дорогой, каждая следующая опирается на
предыдущую.

```bash
# 1. Electron и plist
plutil -p "/Applications/T3 Code (Alpha).app/Contents/Info.plist" | grep -i minimumsystem
#    ожидается LSMinimumSystemVersion => "12.0"

# 2. Mach-O: minos должен быть 12.0, а не 13.0
vtool -show-build "/Applications/T3 Code (Alpha).app/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework" | grep minos

# 3. Подпись валидна
codesign -v "/Applications/T3 Code (Alpha).app"

# 4. Приложение живёт, все процессы на месте
pgrep -fl "Applications/T3 Code"      # main, gpu, network, renderer, resource-monitor

# 5. Backend отвечает (порт из лога desktop-startup, не обязательно 3773)
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3773/

# 6. Ошибок нет
grep -iE "error|fatal|dyld|Symbol not found" ~/.t3/userdata/logs/desktop.trace.ndjson
```

Окно должно быть 1568×1184, отрисовка — тёмная тема, сайдбар темнее контента.
Ошибки в логе `dyld` или `SMAppService` означают, что Electron не тот.

---

## Подводные камни

**Скобки в имени ломают `pgrep`/`pkill`.** В имени приложения есть
`(Alpha)`, а `pgrep -f` трактует это как regex-группу:

```bash
pgrep -f "T3 Code (Alpha) Helper"     # ⛔ молча, ничего не находит
grep -F "T3 Code"                    # ✅ литеральный поиск
```

Молчащий `pgrep` тут же приводит к выводу «процесса нет», и можно
незаметно убить не то или решить, что рендерер упал. `ps -Ao pid=,command=`
и `grep -F` надёжнее.

**`otool -l` не переваривает скобки в пути.** Отдаёт
`can't open file` на `Contents/MacOS/T3 Code (Alpha)`. Обходите через symlink
с коротким именем либо используйте `vtool -show-build`.

**`codesign` без `--deep`** на бандле с фреймворками не переподписывает
вложенные бинарники — подпись потом не пройдёт проверку.

**`codesign` идёт по коду в `app.asar`?** Нет. Правка `app.asar` ломает
`ElectronAsarIntegrity` (это проверка в рантайме, не в подписи), поэтому
`app.asar` руками не трогайте. В отличие от `LSMinimumSystemVersion`, его
можно менять только пересборкой.

**`smoke-test` — дешёвая проверка, что Electron вообще грузится.** Запускает
`dist-electron/boot.cjs` на установленном Electron и ждёт успеха. На этой
машине проходит (`Desktop smoke test passed.`), то есть годен как ранний
«зелёный сигнал» после смены версии Electron:

```bash
node apps/desktop/scripts/smoke-test.mjs
```

Но он проверяет только запуск main-процесса. Отрисовку окна, рендерер и
работоспособность фич не покрывает — для этого шаг 5–6 из «Проверки».

---

## Тулчейн живёт в `~/.local/t3-build-tools`

Перенос выполнен, `$TOOLS` в `rebuild-t3code-macos12.sh` уже указывает туда.
`rebuild-t3code-macos12.sh` делает всё сам (install → build → zip → подпись →
проверка `minos`).

Симлинки в `$TOOLS/vp-bin` **должны быть относительными**:

```bash
cd ~/.local/t3-build-tools/vp-bin
for f in bun bunx vp vpr vpx yarn yarnpkg; do
  rm -f "$f" && ln -s ../vp-data/current/bin/vp "$f"
done
```

Абсолютные симлинки на временную папку opencode уже умирали один раз: после
очистки `/private/var/folders/.../T/opencode/tools` все команды падали с
`no such file or directory`, хотя `vp-data` лежал рядом и был цел. Если
`vp --version` не запускается — проверьте `readlink vp-bin/vp` первым делом.

Проверка тулчейна целиком:

```bash
export TOOLS="$HOME/.local/t3-build-tools"
export PATH="$TOOLS/node-v24.13.1-darwin-x64/bin:$TOOLS/npm-global/bin:$TOOLS/vp-bin:/opt/local/bin:$PATH"
export npm_config_prefix="$TOOLS/npm-global"
export VP_BIN_DIR="$TOOLS/vp-bin" VP_DATA_DIR="$TOOLS/vp-data" \
       VP_CACHE_DIR="$TOOLS/vp-cache" VP_NODE_MANAGER=no

node -v && pnpm -v && vp --version
```

---

## Если приехал апдейт с macOS 13

Симптомы: `kLSIncompatibleSystemVersionErr` в
`~/Library/Caches/com.t3tools.t3code.ShipIt/ShipIt_stderr.log`, приложение
перестало открываться, версия в `Info.plist` 0.0.43+.

1. Проверьте, не появился ли `app-update.yml` — если да, удалите, он и есть
   причина.
2. Поставьте 0.0.45 из `release/` по инструкции выше.
3. Не соглашайтесь на обновление из UI.

Этот сценарий не должен наступать сам: `minos 12.0` зафиксирован на линейке
43.x, и апстрим на неё не вернётся (см. «43.x — навсегда на macOS 12»).
Если такое всё-таки произошло — значит в форке пин уехал с 43.x, и лечится
возвратом на последний 43.x, а не тулчейном.

Выбор, если Monterey когда-нибудь придётся оставить: обновлять тулчейн до 44.x
и мириться с macOS 13+ на `MacPro5,1` (официально не поддерживается, только
OpenCore Legacy Patcher), либо остаться на этом конфиге. На 43.7.7 всё
работает, запас есть.
