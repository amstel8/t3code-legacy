import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

const run = NodeUtil.promisify(NodeChildProcess.execFile);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exists = async (file) =>
  NodeFSP.stat(file).then(
    () => true,
    () => false,
  );
async function checksum(file) {
  const hash = NodeCrypto.createHash("sha256");
  for await (const chunk of NodeFS.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function replaceApp(staged, target, previous, move = NodeFSP.rename) {
  await move(target, previous);
  try {
    await move(staged, target);
  } catch (error) {
    await move(previous, target);
    throw error;
  }
}

async function backupState(source, destination) {
  await NodeFSP.mkdir(destination, { mode: 0o700 });
  for (const entry of await NodeFSP.readdir(source, { withFileTypes: true })) {
    if (
      !entry.isFile() ||
      entry.name.startsWith("server-owner.sqlite") ||
      (!entry.name.includes(".sqlite") && !entry.name.endsWith(".json"))
    )
      continue;
    const from = NodePath.join(source, entry.name);
    const to = NodePath.join(destination, entry.name);
    const before = await NodeFSP.stat(from);
    await NodeFSP.copyFile(from, to);
    const after = await NodeFSP.stat(from);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      (await checksum(from)) !== (await checksum(to))
    )
      throw new Error("State changed during backup: " + entry.name);
  }
}

async function waitForExit(pid) {
  const deadline = Date.now() + 60_000;
  while (true) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
    if (Date.now() >= deadline) throw new Error("Application did not stop; update cancelled.");
    await pause(250);
  }
}

export async function install(jobDirectory) {
  const job = JSON.parse(await NodeFSP.readFile(NodePath.join(jobDirectory, "job.json"), "utf8"));
  const previous = NodePath.join(job.directory, "previous.app");
  const status = async (stage, extra = {}) => {
    const temp = NodePath.join(jobDirectory, "status.tmp");
    await NodeFSP.writeFile(
      temp,
      JSON.stringify({ stage, version: job.version, previous, ...extra }),
      {
        mode: 0o600,
      },
    );
    await NodeFSP.rename(temp, NodePath.join(jobDirectory, "status.json"));
  };
  const launch = async () => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_NO_ASAR;
    const args = ["-n", "-a", job.target];
    for (const name of ["HOME", "T3CODE_HOME", "T3CODE_PORT"]) {
      if (env[name]) args.push("--env", `${name}=${env[name]}`);
    }
    await run("/usr/bin/open", args, { env });
  };
  let replaced = false;
  try {
    if (
      !Number.isSafeInteger(job.parentPid) ||
      job.parentPid <= 1 ||
      !job.target.endsWith(".app") ||
      !job.staged.startsWith(job.directory + NodePath.sep)
    )
      throw new Error("Invalid update job.");
    await status("ready");
    process.send?.("ready");
    await waitForExit(job.parentPid);
    const runtimeFile = NodePath.join(job.stateDir, "server-runtime.json");
    if (await exists(runtimeFile)) {
      const { pid } = JSON.parse(await NodeFSP.readFile(runtimeFile, "utf8"));
      if (Number.isSafeInteger(pid) && pid > 1) await waitForExit(pid);
    }
    await status("backing-up");
    if (await exists(job.stateDir))
      await backupState(job.stateDir, NodePath.join(job.directory, "userdata-backup"));
    await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", job.staged]);
    await status("installing");
    await replaceApp(job.staged, job.target, previous);
    replaced = true;
    await status("launching");
    await launch();
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      try {
        const runtime = JSON.parse(await NodeFSP.readFile(runtimeFile, "utf8"));
        if (runtime.pid !== job.parentPid && runtime.serverVersion === job.version) {
          const response = await fetch(
            `http://127.0.0.1:${runtime.port}/.well-known/t3/environment`,
            { signal: AbortSignal.timeout(2000) },
          );
          if (response.ok && (await response.json()).serverVersion === job.version) {
            await status("complete");
            return;
          }
        }
      } catch {
        /* The restarted backend writes its runtime record during startup. */
      }
      await pause(500);
    }
    throw new Error(
      "Installed application did not confirm backend readiness; previous app and state backup retained.",
    );
  } catch (error) {
    await status("failed", { error: String(error), replaced });
    if (!replaced) {
      await launch().catch(() => {});
    }
    throw error;
  }
}

if (
  process.argv[1] &&
  NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url)
) {
  install(process.argv[2]).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
