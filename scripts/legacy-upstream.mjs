#!/usr/bin/env node
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const root = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const run = (args, cwd = root) =>
  NodeChildProcess.execFileSync(args[0], args.slice(1), {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
const mode = process.argv[2] || "check";
const release = JSON.parse(run(["gh", "api", "repos/pingdotgg/t3code/releases/latest"]));
const tag = process.argv[3] || release.tag_name;
if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error("Only stable upstream tags are supported.");
const version = tag.slice(1);
const workspace = NodePath.join(NodePath.dirname(root), `t3code-release-${version}`);
if (mode === "check") {
  console.log(
    JSON.stringify({ upstream: release.tag_name, url: release.html_url, workspace }, null, 2),
  );
} else if (mode === "prepare") {
  if (run(["git", "status", "--porcelain"])) throw new Error("Start from a clean fork checkout.");
  run(["git", "fetch", "--no-tags", "upstream", `refs/tags/${tag}:refs/tags/${tag}`]);
  run(["git", "worktree", "add", workspace, "-b", `legacy/release-${version}`, "HEAD"]);
  const merge = NodeChildProcess.spawnSync("git", ["merge", "--no-commit", "--no-ff", tag], {
    cwd: workspace,
    stdio: "inherit",
  });
  console.log(
    `Prepared ${workspace}. Review FORK.md invariants, pin our Electron, update release versions, then commit.`,
  );
  if (merge.status !== 0) {
    console.error(
      "Merge stopped. Resolve conflicts in that workspace; the source checkout is unchanged.",
    );
    process.exitCode = 1;
  }
} else if (mode === "build") {
  if (run(["git", "status", "--porcelain"]))
    throw new Error("Commit the reviewed merge and release versions before building.");
  const result = NodeChildProcess.spawnSync("./rebuild-t3code-macos12.sh", [], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, T3CODE_VERSION: version },
  });
  if (result.status !== 0) process.exitCode = result.status || 1;
  else run([process.execPath, "scripts/legacy-release.mjs", "sign", version]);
} else if (mode === "draft") {
  if (run(["git", "status", "--porcelain"]))
    throw new Error("Commit reviewed changes before preparing a release.");
  // A draft stays invisible to installed clients until hardware validation and publication.
  const head = run(["git", "rev-parse", "HEAD"]);
  run(["git", "push", "origin", "HEAD"]);
  console.log(
    run([
      "gh",
      "release",
      "create",
      `v${version}-macos12`,
      "--repo",
      "amstel8/t3code-legacy",
      "--draft",
      "--target",
      head,
      "--title",
      `T3 Code ${version} — macOS 12 Intel / OpenGL`,
      "--notes",
      "Custom Electron for Monterey, Metal and automatic OpenGL. Signed update manifest for in-app updates. Hardware validation pending.",
      `release/T3-Code-${version}-x64.zip`,
      "release/SHA256SUMS.txt",
      "release/legacy-update.json",
    ]),
  );
} else
  throw new Error(
    "Usage: legacy-upstream.mjs check | prepare [vX.Y.Z] | build vX.Y.Z | draft vX.Y.Z",
  );
