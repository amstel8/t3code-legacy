> [!IMPORTANT]
> **This is a fork for Intel Macs on macOS 12 Monterey**, including older Macs
> without AVX or Metal. Download builds from
> [this repository's releases](https://github.com/amstel8/t3code-legacy/releases).
>
> The canonical project and its documentation are at
> [pingdotgg/t3code](https://github.com/pingdotgg/t3code). Upstream installers
> and stock Electron 44 binaries target macOS 13 or newer.

## Monterey and OpenGL support

This fork uses our **custom Electron 44.9.0 / Chromium 152 build for macOS 12**,
from [legacy-brave-electron-opengl](https://github.com/amstel8/legacy-brave-electron-opengl/releases/tag/electron-v44.9.0-macos12-x64).
It replaces the earlier Electron 43.x pin.

On Macs without a Metal device, the runtime automatically selects **ANGLE OpenGL**.
This runtime was verified on a MacBookPro7,1 with a Core 2 Duo and GeForce
320M: WebGL reports NVIDIA OpenGL 3.3, and the GPU process uses `--use-angle=gl`.
OpenGL capabilities depend on the installed graphics driver.

The fork also retains a 60-second OpenCode 2 model discovery deadline so older
CPUs have time to start the server and load its catalog.

The build script pins the Electron release URL and SHA256 and passes the custom
runtime to both the launcher and electron-builder. Changing only the npm Electron
version would still select incompatible stock binaries.

## Installing

Download the `T3-Code-<version>-x64.zip` asset from
[releases](https://github.com/amstel8/t3code-legacy/releases), verify it with the
attached `SHA256SUMS.txt`, and extract it. Quit the previous T3 Code before
copying **T3 Code (Beta).app** to `/Applications`.

The ZIP already contains an ad-hoc signed application. It has no Apple Developer
ID signature or notarization. If macOS blocks the downloaded app:

```bash
xattr -dr com.apple.quarantine "/Applications/T3 Code (Beta).app"
```

ZIP is used because the upstream DMG background conversion uses `sips`, which
cannot read SVG on Monterey. Server data lives outside the app bundle in
`~/.t3/userdata`; do not delete that directory when replacing the application.

## Updating and rebuilding

`origin` is `amstel8/t3code-legacy`; `upstream` is `pingdotgg/t3code`.
Merge the desired upstream release tag, retain our custom Electron version and
OpenCode cold-start deadline when resolving conflicts, then run:

```bash
T3CODE_VERSION=<version> ./rebuild-t3code-macos12.sh
```

The script downloads and verifies our Electron archive if needed, builds the
app, signs it ad-hoc, and packages the signed ZIP. Build prerequisites and
verification steps are in [AGENTS.macos12.md](./AGENTS.macos12.md).

**Do not open pull requests against upstream for these fork-specific changes.**

**Do not add the official `app-update.yml` to the bundle.** These builds omit
that feed so an automatic upstream update cannot replace the custom runtime
with an incompatible stock build. Update manually from this fork's releases.

---

# T3 Code

T3 Code is an "agent harness control surface". It enables control of the agents on your machine with a best-in-class mobile app ([iOS](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824), [Android](https://play.google.com/store/apps/details?id=com.t3tools.t3code)), [web app](https://app.t3.codes) and [Electron-based desktop app](https://t3.codes).

Works with your subscriptions on Claude Code, Codex, Cursor, Grok Build, OpenCode, and Google Antigravity. If they're set up on your computer, T3 Code can control them.

## "Wait, what are you selling me?"

Nothing. We built T3 Code because we wanted the best possible development experience with agents. We were inspired by existing solutions like the Codex desktop app, Conductor, Claude Desktop and Cursor Glass, but none met our bar.

We wanted something performant, remote-ready, and truly open. If we ever go the wrong direction, we want you to have everything you need to fork and build the editor that you want.

## Installation

> [!WARNING]
> T3 Code currently supports Codex, Claude, Cursor, Grok Build, OpenCode, and Antigravity. Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
> - Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`
> - Antigravity: enable it in Settings, then use **Install Antigravity** and **Sign in with Google**. No CLI is required.

### Command line

```bash
curl -fsSL https://t3.codes/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://t3.codes/install.ps1 | iex
```

Then run `t3` to start the server and open the local web app. `t3 service install` keeps it running in the background, `t3 update` moves to a newer release, and `t3 --help` has the full reference.

To try it once without installing, run `npx t3@latest` instead.

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/pingdotgg/t3code/releases), or from your favorite package registry:

#### Windows (`winget`)

```bash
winget install T3Tools.T3Code
```

#### Windows (`scoop`)

```bash
scoop install extras/t3code
```

#### macOS (Homebrew)

```bash
brew install --cask t3-code
```

#### Debian, Ubuntu (`.deb`)

Download the `.deb` from [GitHub Releases](https://github.com/pingdotgg/t3code/releases), then:

```bash
sudo apt install ./T3-Code-*.deb
```

#### Arch Linux (AUR)

Stable:

```bash
yay -S t3code-bin
```

Nightly:

```bash
yay -S t3code-nightly-bin
```

The AUR packaging is maintained in this repository under [`packaging/aur`](./packaging/aur).

## Some notes

We are very very early in this project. Expect bugs.

We are (mostly) not accepting contributions yet. Small fixes may be considered. Big features will not be.

## Documentation

Full docs live in [docs/](./docs). There's no docs site yet.

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Project settings](./docs/user/project-settings.md)
- [Appearance preferences](./docs/user/appearance.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Connect Claude Code, Codex, ChatGPT and other agents over MCP](./docs/user/outside-agents.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- [Run T3 Code as a background service](./docs/user/background-service.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## If you REALLY want to contribute still.... read this first

### Install `vp`

T3 Code uses Vite+ so you'll need to install the global `vp` command-line tool.

#### macOS / Linux

```bash
curl -fsSL https://vite.plus | bash
```

#### Windows

```bash
irm https://vite.plus/ps1 | iex
```

Checkout their getting started guide for more information: https://viteplus.dev/guide/

### Install dependencies

```bash
vp i
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before reporting a bug or opening a PR.

Have a feature request? Start an [Ideas discussion](https://github.com/pingdotgg/t3code/discussions/categories/ideas).

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
