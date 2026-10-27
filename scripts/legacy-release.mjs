#!/usr/bin/env node
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeURL from "node:url";

const repo = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const run = (...args) =>
  NodeChildProcess.execFileSync(args[0], args.slice(1), {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
const keyPath =
  process.env.T3CODE_UPDATE_PRIVATE_KEY ||
  NodePath.join(NodeOS.homedir(), ".local/t3-build-tools/keys/t3code-update.pem");
const publicPath = NodePath.join(repo, "scripts/legacy-update-public.pem");
const mode = process.argv[2];

if (mode === "init-key") {
  // Exclusive creation prevents an accidental key rotation that would strand existing installs.
  await NodeFSP.mkdir(NodePath.dirname(keyPath), { recursive: true, mode: 0o700 });
  const keys = NodeCrypto.generateKeyPairSync("ed25519");
  await NodeFSP.writeFile(keyPath, keys.privateKey.export({ type: "pkcs8", format: "pem" }), {
    flag: "wx",
    mode: 0o600,
  });
  await NodeFSP.writeFile(publicPath, keys.publicKey.export({ type: "spki", format: "pem" }), {
    flag: "wx",
  });
  console.log(
    "Signing key created. Back up the private key separately; only the public key belongs in git.",
  );
} else if (mode === "sign") {
  const version = process.argv[3];
  if (!/^\d+\.\d+\.\d+$/.test(version || ""))
    throw new Error("Usage: legacy-release.mjs sign X.Y.Z");
  if (run("git", "status", "--porcelain"))
    throw new Error("Commit the reviewed source before signing a release.");
  const artifact = `T3-Code-${version}-x64.zip`;
  const archive = NodePath.join(repo, "release", artifact);
  const hash = NodeCrypto.createHash("sha256");
  let size = 0;
  for await (const chunk of NodeFS.createReadStream(archive)) {
    hash.update(chunk);
    size += chunk.length;
  }
  const privateKey = await NodeFSP.readFile(keyPath);
  const publicKey = await NodeFSP.readFile(publicPath);
  if (
    NodeCrypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString() !==
    publicKey.toString()
  )
    throw new Error("Signing key differs from the public key embedded in this fork.");
  const desktop = JSON.parse(
    await NodeFSP.readFile(NodePath.join(repo, "apps/desktop/package.json")),
  );
  if (desktop.version !== version)
    throw new Error("Commit the release package versions before signing.");
  const embedded = JSON.parse(
    run(
      "/usr/bin/unzip",
      "-p",
      archive,
      "T3 Code (Beta).app/Contents/Resources/legacy-update-config.json",
    ),
  );
  if (
    embedded.publicKey !== publicKey.toString() ||
    embedded.sourceCommit !== run("git", "rev-parse", "HEAD") ||
    embedded.electron !== desktop.dependencies.electron
  )
    throw new Error("Rebuild the archive from this commit and signing key before publishing.");
  const plistBytes = NodeChildProcess.execFileSync("/usr/bin/unzip", [
    "-p",
    archive,
    "T3 Code (Beta).app/Contents/Info.plist",
  ]);
  const plist = JSON.parse(
    NodeChildProcess.execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", "-"], {
      input: plistBytes,
      encoding: "utf8",
    }),
  );
  if (
    plist.CFBundleShortVersionString !== version ||
    plist.LSMinimumSystemVersion !== "12.0" ||
    plist.CFBundleIdentifier !== "com.t3tools.t3code"
  )
    throw new Error("Archive version or compatibility does not match the release.");
  const payload = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      version,
      tag: `v${version}-macos12`,
      artifact,
      size,
      sha256: hash.digest("hex"),
      electron: desktop.dependencies.electron,
      arch: "x64",
      minOS: "12.0",
      sourceCommit: run("git", "rev-parse", "HEAD"),
      releaseNotes: `T3 Code ${version} for macOS 12 Intel. Custom Electron ${desktop.dependencies.electron}, Metal and automatic OpenGL. Updates from amstel8/t3code-legacy.`,
    }),
  );
  const signature = NodeCrypto.sign(null, payload, privateKey);
  if (!NodeCrypto.verify(null, payload, publicKey, signature))
    throw new Error("Signature self-check failed.");
  await NodeFSP.writeFile(
    NodePath.join(repo, "release/legacy-update.json"),
    JSON.stringify(
      { payload: payload.toString("base64"), signature: signature.toString("base64") },
      null,
      2,
    ) + "\n",
  );
  console.log("Signed release/legacy-update.json");
} else {
  throw new Error("Usage: node scripts/legacy-release.mjs init-key | sign X.Y.Z");
}
