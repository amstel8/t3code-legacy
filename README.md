> [!IMPORTANT]
> **This is a fork.** It is not the official T3 Code distribution, and it is not a
> general-purpose one.
>
> This fork exists to build current T3 Code for **Intel Macs on macOS 12 Monterey
> that have no AVX** — the `MacPro5,1` class of hardware, e.g. a Xeon X5690.
>
> - **Canonical project and all documentation:** [pingdotgg/t3code](https://github.com/pingdotgg/t3code)
>   and its [`docs/`](https://github.com/pingdotgg/t3code/tree/main/docs). The
>   `docs/` folder here is just a copy of upstream's; treat upstream as the source of truth.
> - **Do not use upstream's installers for this machine.** `install.sh`, the
>   Homebrew cask, and upstream's `.dmg`/`.zip` releases are all built for
>   macOS 13 or newer and will not launch here. Releases published in _this_
>   repository are the ones that work.
> - **Fork-specific build notes:** [AGENTS.macos12.md](./AGENTS.macos12.md) and
>   [`rebuild-t3code-macos12.sh`](./rebuild-t3code-macos12.sh).

## What this fork changes

Exactly one thing in the build inputs: the desktop app is pinned to **Electron
43.x**, the last Electron line built against macOS 12.

Upstream ships macOS 13+ artifacts from 0.0.41 onwards. Electron 44+ binaries
carry `LSMinimumSystemVersion: 13.0` and a Mach-O `minos 13.0`, so
LaunchServices refuses the app with `kLSIncompatibleSystemVersionErr`. Lowering
`minos` by hand does not help, because those binaries genuinely call macOS 13
APIs such as `SMAppService`. Electron 43.x references them only as weak
imports, so it loads on Monterey.

That pin is stable, not a stopgap: Electron drops OS support on **major**
version lines, so 43.x is the last line that will ever target macOS 12, and it
is heading into EOL. Verified `minos 12.0` on both ends of the line (43.0.0 and
43.7.7).

The artifacts here are `x86_64`, built at baseline `x86-64` so they need no AVX.
That has been confirmed on a CPU reporting only SSE4.1/SSE4.2 — the app runs
with no `SIGILL` and no crash reports.

Functional parity with upstream is otherwise unchanged; the fork adds no
features of its own.

## Installing on macOS 12 without AVX

Grab the macOS x64 asset from this repository's [releases](https://github.com/amstel8/t3code-legacy/releases),
unzip it, and move the app to `/Applications`:

```bash
unzip T3-Code-*-x64.zip
xattr -dr com.apple.quarantine "T3 Code (Alpha).app"
codesign --force --deep --sign - --timestamp=none "T3 Code (Alpha).app"
cp -R "T3 Code (Alpha).app" /Applications/
open -a "/Applications/T3 Code (Alpha).app"
```

Notes:

- Only `.zip` assets are published. There is no `.dmg`: the upstream DMG step
  converts an SVG with `sips`, which does not read SVG, so that step fails on
  this machine. The zip contains the identical `.app`.
- The ad-hoc `codesign` above is required. Electron refuses to start without a
  valid signature, and notarization needs a developer account.
- Your data lives in `~/.t3/userdata` (chats, settings, database), outside the
  app bundle, so replacing the bundle does not lose anything.

## Updating

`git fetch upstream && git checkout main && git merge upstream/main`, then
re-apply the Electron pin (upstream will have moved it forward again) and
rebuild with `./rebuild-t3code-macos12.sh`. Follow the update cycle in
[AGENTS.macos12.md](./AGENTS.macos12.md).

**Never copy `app-update.yml` into the bundle.** It is absent from these builds,
which is what keeps auto-update switched off. Adding it lets the app pull an
upstream macOS 13 build over itself and stop launching, which is the exact
failure this fork exists to avoid. Turn down update prompts in the UI.

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
