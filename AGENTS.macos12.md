# T3 Code для macOS 12 / Intel

Форк: `amstel8/t3code-legacy` (`origin`). Upstream: `pingdotgg/t3code`.
В `main` влит тег `v0.1.0`; PR в upstream не нужен.

## Runtime

Теперь используем **собственный Electron 44.7.2**, собранный для Monterey,
вместо прежнего пина на официальный 43.x. Официальный npm Electron 44
по-прежнему требует macOS 13: одного изменения номера зависимости недостаточно.

Источник: https://github.com/amstel8/legacy-brave-electron-opengl/releases/tag/electron-v44.7.2-macos12-x64

Архив: `electron-v44.7.2-macos12-darwin-x64.zip`.
SHA256: `f513ed330cc170a1339ce264db947d7bfaf39dcf726852c92c57bd8025136de7`.

`rebuild-t3code-macos12.sh` скачивает этот конкретный релиз при отсутствии
runtime, проверяет SHA256 и распаковывает в
`~/.local/t3-build-tools/electron-44.7.2-macos12/dist`.
Можно задать другой распакованный runtime через `T3CODE_ELECTRON_DIST`:
каталог должен содержать `Electron.app` и `version`, совпадающий с зависимостью
`electron` в `apps/desktop/package.json`.

Этот путь используют и launcher/ensure-runtime, и упаковщик electron-builder
(`electronDist`), поэтому upstream runtime не должен попасть в артефакт.
Зависимость npm нужна для типов и версии ABI, бинарники берём из нашего релиза.

Исходная сборка доступна по SSH `macpro@10.0.1.124` в
`/Users/macpro/Documents/chromium-build/projects/electron/src/out/ReleaseMacOS12`.
Пароли в репозитории не сохранять.

## Пересборка

```bash
./rebuild-t3code-macos12.sh
# При следующем релизе после git fetch upstream и git merge <tag>:
T3CODE_VERSION=<version> ./rebuild-t3code-macos12.sh
```

Тулчейн: Node 24.13.1, pnpm 11.10.0 и vp в `~/.local/t3-build-tools`;
Rust и системные build tools доступны через `/opt/local/bin`.
Скрипт устанавливает зависимости, выставляет версию через upstream
`update-release-package-versions.ts`, собирает desktop/server/web, упаковывает
x64 ZIP, подписывает приложение ad-hoc и перепаковывает подписанный `.app`.
Используется ZIP: `sips` на Monterey не конвертирует SVG-фон для DMG.

Результат: `release/T3-Code-0.1.0-x64.zip`, `release/SHA256SUMS.txt`.
Приложение теперь называется `T3 Code (Beta).app`.

При обновлении Electron поменять версию зависимости, исключение
`minimumReleaseAgeExclude`, URL/контрольную сумму/кэш в скрипте.
Не использовать плавающую ссылку на latest: в репозитории есть также Brave.

## Проверка и установка

Проверять `LSMinimumSystemVersion`, Mach-O `minos`, подпись и реальную
`process.versions.electron`/ABI. Глобальные проверки репозитория не запускать
(см. `AGENTS.md`). GUI/браузер запускать только по запросу пользователя.

Проверено также на MacBookPro7,1 (Core 2 Duo, GeForce 320M, macOS 12.7.6):
подпись, запуск GUI/backend, загрузка ffi-rs/keyring/fff/passkeys и реальный
PTY-процесс работают. WebGL сообщает NVIDIA OpenGL 3.3 через ANGLE;
GPU-процесс автоматически получает `--use-angle=gl` без флагов на главном процессе.

Для изолированной проверки GUI задавать **и `HOME`, и `T3CODE_HOME`**:
T3CODE_HOME отделяет серверное состояние, но Electron-профиль на macOS
создаётся в `$HOME/Library/Application Support/t3code-v2` независимо от него.

Не менять работающее приложение в `/Applications` во время работы агента.
Собранный ZIP можно распаковать и установить после закрытия текущего T3 Code.
Не убивать процессы по шаблону — см. правило 1 в `AGENTS.md`.
Не запускать проверочный сервер против `~/.t3/userdata`.

В локальную сборку не добавлять официальный update feed: он может заменить
наш runtime официальным несовместимым. Не использовать `--mock-updates`.
