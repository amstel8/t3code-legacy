# Legacy Monterey fork

Upstream baseline: **`pingdotgg/t3code` tag `v0.1.5`**.
Our default branch is `main`; `origin` is `amstel8/t3code-legacy` and `upstream`
is `pingdotgg/t3code`. Use upstream tags and merge them; keep the fork commits
in history rather than copying a new source snapshot over this checkout.

## Changes to preserve

| Difference                                                                                                                        | Owner                                                                                                                         | Regression proof                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Custom Electron 45.1.0, macOS 12 and automatic OpenGL on Macs without Metal                                                       | `apps/desktop/package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`; archive URL and checksum in `rebuild-t3code-macos12.sh` | Final app signature, Mach-O minimum OS, runtime version and GUI on real hardware                     |
| Runtime override and Electron 45 ABI 150 (`patches/node-abi@4.33.0.patch`)                                                        | `apps/desktop/scripts/ensure-electron-runtime.mjs`, `scripts/build-desktop-artifact.ts`                                       | `scripts/build-desktop-artifact.test.ts` checks custom `electronDist` and no update feed             |
| 60-second OpenCode 2 discovery deadline, including cold startup and stabilization                                                 | `packages/provider-opencode/src/server/status.ts`                                                                             | `status.legacy.test.ts`: 45-second cold start, bounded changing/empty catalogs and slow warm refresh |
| A successful OpenCode refresh with explicit empty options clears stale variants; partial/failed discovery retains useful metadata | `apps/server/src/provider/ProviderRegistry.ts`                                                                                | `ProviderRegistry.legacy.test.ts`: ready/empty, error/empty and missing metadata for several models  |
| Build on our Monterey-compatible Node 24.13.1 toolchain; allow upstream Node 26.12.1 as well                                      | root `package.json`, `rebuild-t3code-macos12.sh`                                                                              | Targeted typechecks, actual bundle load and packaged Node runtime                                    |
| Signed ZIP, signed fork manifest and no upstream update feed                                                                      | `rebuild-t3code-macos12.sh`                                                                                                   | Verify signature, checksums and absence of `app-update.yml` in the final archive                     |

The 30-second **OpenCode server plugin activation** wait is a separate change
in [opencode-legacy-cpu](https://github.com/amstel8/opencode-legacy-cpu), not a
second timeout in T3. Keep both when installing OpenCode and T3 together.
Do not invent unsupported model variants or clear users' databases to work
around a stale catalog.

## Update to another upstream release

1. Start with a clean working tree. Fetch the chosen tag and inspect the merge:
   `git fetch upstream tag vX.Y.Z`, then `git merge --no-commit vX.Y.Z`.
2. Resolve conflicts against the table above. Keep upstream provider/model
   features while retaining our timing and merge behavior. Update the Electron
   dependency, release-age exception, runtime URL and SHA together only when a
   new custom runtime has passed Monterey/Core 2 Duo checks. A stock Electron
   version bump is not a compatible replacement.
3. Use the package-manager version pinned by the merged `package.json`.
   The build wrapper installs that pnpm into its own versioned tool directory.
   If dependency pins changed, deliberately regenerate `pnpm-lock.yaml` once;
   ordinary builds use `--frozen-lockfile`. After a pnpm major upgrade, obsolete
   workspace `node_modules/.bin/tsc` shims can still point at the removed compiler.
   Remove those generated, broken shims or recreate the affected dependency
   directories, then reinstall; do not downgrade the compiler or commit `node_modules`.
4. Set the four release package versions with
   `node scripts/update-release-package-versions.ts X.Y.Z`, update this baseline,
   and commit the resolved merge. Preserve the old release tag for rollback.
5. From an Electron-hosted agent shell, unset `ELECTRON_RUN_AS_NODE` and
   `ELECTRON_NO_ASAR` first (the build wrapper does this automatically).
   Run `pnpm verify:legacy`, relevant typechecks and the changed-file checks
   required by `AGENTS.md`. No repository-wide test/typecheck sweep is needed.
6. Build with `T3CODE_VERSION=X.Y.Z ./rebuild-t3code-macos12.sh`.
   The wrapper verifies behavior before building and uses the canonical
   packager's version-stamping/build lock. It signs the resulting app and
   removes the unsigned ZIP's obsolete blockmap before writing SHA256SUMS.
7. Check the final archive, then install on the T9900 MacBook first. Verify the
   interface, server readiness and OpenCode model variants, including custom
   models. Only then update the other Mac. Keep rollback copies; preserve
   `~/.t3/userdata`. Finish this agent's turn before restarting its own T3 host.
8. Push `main` and publish a distinct `vX.Y.Z-macos12` release with the signed
   ZIP and `SHA256SUMS.txt`. Do not replace an existing release silently.

The wrapper builds a desktop application. Upstream standalone server/CLI
release scripts and their Node 26 downloads are not a legacy CPU distribution.
[AGENTS.macos12.md](AGENTS.macos12.md) contains local toolchain and installation
instructions; [README.md](README.md) is the download entry point.

## Release automation and in-app updates

`node scripts/legacy-upstream.mjs check` discovers the latest stable upstream.
`prepare [vX.Y.Z]` creates a sibling worktree and merges without committing;
conflicts stop there for review. Preserve the compatibility table above, stamp
the four release package versions, and commit the reviewed source. In that
worktree run `build vX.Y.Z`, then `draft vX.Y.Z` to push its branch and create
a draft release with ZIP, checksums and `legacy-update.json`. Publication and
installation stay separate from preparation; publish only after hardware checks.

The Monterey wrapper embeds a public Ed25519 key and the standalone installer.
The existing desktop update UI checks this fork's latest GitHub release, accepts
only signed stable x64/macOS 12 manifests, verifies the downloaded ZIP, signature,
app identity, minimum OS and Electron version, then stages on the install volume.
On restart the helper waits for the app/backend to exit, copies database files,
retains the previous app, replaces it, and records backend readiness. Backups stay
beside the installed app in its hidden `.t3-update-*` directory; install logs are
under the Electron profile's `legacy-updates/install-*`. Failed replacement
restores the old app. A failure after launch retains backups for manual recovery,
because a newer backend may already have migrated the database.

The private release key is **outside the repository** at
`~/.local/t3-build-tools/keys/t3code-update.pem`, or the path supplied by
`T3CODE_UPDATE_PRIVATE_KEY`. Back it up separately. Never commit it, upload it
as an asset, or regenerate it for routine builds. The public key is tracked in
`scripts/legacy-update-public.pem`. `legacy-release.mjs sign X.Y.Z` requires a
clean committed source and the matching private key. Existing releases without
a signed manifest are ignored; old installations need one manual installation
of the first updater-enabled build. Only the stable channel is supported.
Release ZIP requests allow up to one hour on slow CDN connections; the installed
0.1.3 client retains its original 15-minute limit until it has been updated.
