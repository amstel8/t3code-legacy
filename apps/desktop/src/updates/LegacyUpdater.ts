// @effect-diagnostics nodeBuiltinImport:off -- Native EventEmitter adapter with the same Promise API as electron-updater.
// @effect-diagnostics globalFetch:off -- Streaming downloads run at the native updater boundary outside Effect fibers.
// @effect-diagnostics globalTimers:off -- Bound the detached helper readiness handshake before quitting Electron.
import { app } from "electron";
import * as NodeCrypto from "node:crypto";
import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import {
  decodeLegacyManifest,
  isNewerLegacyVersion,
  type LegacyManifest,
} from "./legacyManifest.ts";

const run = NodeUtil.promisify(NodeChildProcess.execFile);
const repository = "amstel8/t3code-legacy";
const configName = "legacy-update-config.json";

export function hasLegacyUpdateConfig(resourcesPath: string): boolean {
  return NodeFS.existsSync(NodePath.join(resourcesPath, configName));
}

// Only the Monterey wrapper ships this marker. Other platforms keep their stock updater.
export function useLegacyUpdater(): boolean {
  return app?.isPackaged === true && hasLegacyUpdateConfig(process.resourcesPath);
}

export class LegacyUpdater extends NodeEvents.EventEmitter {
  channel: string | null = "latest";
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowPrerelease = false;
  allowDowngrade = false;
  fullChangelog = false;
  disableDifferentialDownload = true;
  private available: LegacyManifest | undefined;
  private prepared: { directory: string; staged: string; manifest: LegacyManifest } | undefined;

  setFeedURL(_options: unknown): void {
    throw new Error("This build only accepts updates from amstel8/t3code-legacy.");
  }

  async checkForUpdates(): Promise<void> {
    if (this.channel !== "latest")
      throw new Error("Legacy macOS builds support the stable update channel only.");
    this.emit("checking-for-update");
    const response = await fetch(
      `https://github.com/${repository}/releases/latest/download/legacy-update.json`,
      { signal: AbortSignal.timeout(60_000) },
    );
    if (response.status === 404) {
      this.emit("update-not-available");
      return;
    }
    if (!response.ok) throw new Error(`GitHub update check failed: HTTP ${response.status}.`);
    const { publicKey } = JSON.parse(
      NodeFS.readFileSync(NodePath.join(process.resourcesPath, configName), "utf8"),
    ) as { publicKey: string };
    const manifest = decodeLegacyManifest(await response.text(), publicKey);
    if (!isNewerLegacyVersion(manifest.version, app.getVersion())) {
      this.emit("update-not-available");
      return;
    }
    this.available = manifest;
    this.emit("update-available", manifest);
  }

  async downloadUpdate(): Promise<void> {
    const manifest = this.available;
    if (!manifest) throw new Error("Check for a new release before downloading.");
    const target = NodePath.resolve(process.resourcesPath, "../..");
    if (NodePath.extname(target) !== ".app")
      throw new Error("Cannot locate the installed application.");
    // Stage on the installation volume so replacement and rollback use atomic renames.
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodePath.dirname(target), ".t3-update-"));
    const archive = NodePath.join(directory, manifest.artifact);
    try {
      const response = await fetch(
        `https://github.com/${repository}/releases/download/${manifest.tag}/${manifest.artifact}`,
        { signal: AbortSignal.timeout(15 * 60_000) },
      );
      if (!response.ok || !response.body)
        throw new Error(`Download failed: HTTP ${response.status}.`);
      const hash = NodeCrypto.createHash("sha256");
      let received = 0;
      const output = await NodeFSP.open(archive, "wx", 0o600);
      try {
        for await (const chunk of response.body) {
          received += chunk.byteLength;
          if (received > manifest.size) throw new Error("Update exceeds its signed size.");
          hash.update(chunk);
          await output.writeFile(chunk);
          this.emit("download-progress", { percent: (received / manifest.size) * 100 });
        }
        await output.sync();
      } finally {
        await output.close();
      }
      if (received !== manifest.size || hash.digest("hex") !== manifest.sha256)
        throw new Error("Update archive checksum verification failed.");
      await run("/usr/bin/ditto", ["-x", "-k", archive, directory]);
      const staged = NodePath.join(directory, "T3 Code (Beta).app");
      await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", staged]);
      const currentConfig = JSON.parse(
        NodeFS.readFileSync(NodePath.join(process.resourcesPath, configName), "utf8"),
      );
      const stagedConfig = JSON.parse(
        NodeFS.readFileSync(NodePath.join(staged, "Contents/Resources", configName), "utf8"),
      );
      if (
        stagedConfig.publicKey !== currentConfig.publicKey ||
        stagedConfig.sourceCommit !== manifest.sourceCommit ||
        stagedConfig.electron !== manifest.electron
      )
        throw new Error("Update provenance does not match its signed manifest.");
      const plist = NodePath.join(staged, "Contents/Info.plist");
      for (const [key, expected] of [
        ["CFBundleShortVersionString", manifest.version],
        ["CFBundleIdentifier", currentConfig.bundleId],
        ["LSMinimumSystemVersion", "12.0"],
      ]) {
        const { stdout } = await run("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plist]);
        if (stdout.trim() !== expected)
          throw new Error(`Update ${key} does not match this application.`);
      }
      const { stdout } = await run(
        NodePath.join(staged, "Contents/MacOS/T3 Code (Beta)"),
        ["-p", "process.versions.electron"],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
      );
      if (stdout.trim() !== manifest.electron) throw new Error("Update runtime version mismatch.");
      this.prepared = { directory, staged, manifest };
      this.emit("update-downloaded", manifest);
    } catch (error) {
      await NodeFSP.rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  async quitAndInstall(_isSilent: boolean, _isForceRunAfter: boolean): Promise<void> {
    const prepared = this.prepared;
    if (!prepared) throw new Error("No verified update is ready to install.");
    const root = NodePath.join(app.getPath("userData"), "legacy-updates");
    await NodeFSP.mkdir(root, { recursive: true, mode: 0o700 });
    const job = await NodeFSP.mkdtemp(NodePath.join(root, "install-"));
    const helper = NodePath.join(job, "install.mjs");
    await NodeFSP.copyFile(
      NodePath.join(process.resourcesPath, "legacy-update-install.mjs"),
      helper,
    );
    const target = NodePath.resolve(process.resourcesPath, "../..");
    await NodeFSP.writeFile(
      NodePath.join(job, "job.json"),
      JSON.stringify({
        ...prepared,
        target,
        parentPid: process.pid,
        executable: NodePath.basename(process.execPath),
        version: prepared.manifest.version,
        stateDir: NodePath.join(
          process.env.T3CODE_HOME?.trim() || NodePath.join(app.getPath("home"), ".t3"),
          "userdata",
        ),
      }),
      { mode: 0o600 },
    );
    const log = await NodeFSP.open(NodePath.join(job, "install.log"), "a", 0o600);
    try {
      const child = NodeChildProcess.spawn(process.execPath, [helper, job], {
        detached: true,
        stdio: ["ignore", log.fd, log.fd, "ipc"],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      });
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          child.disconnect();
          reject(new Error("Update helper did not become ready."));
        }, 15_000);
        child.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once("exit", () => {
          clearTimeout(timeout);
          reject(new Error("Update helper exited before readiness."));
        });
        child.once("message", (message) => {
          clearTimeout(timeout);
          if (message !== "ready") {
            reject(new Error("Update helper refused the job."));
            return;
          }
          child.disconnect();
          resolve();
        });
      });
      child.unref();
    } finally {
      await log.close();
    }
    app.quit();
  }
}
