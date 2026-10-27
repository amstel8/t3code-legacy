import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { replaceApp } from "./legacy-update-install.mjs";

describe("legacy app replacement", () => {
  it("retains the previous app and atomically installs the staged app", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-replace-"));
    try {
      const target = NodePath.join(root, "installed.app");
      const staged = NodePath.join(root, "staged.app");
      const previous = NodePath.join(root, "previous.app");
      await NodeFSP.mkdir(target);
      await NodeFSP.mkdir(staged);
      await NodeFSP.writeFile(NodePath.join(target, "version"), "old");
      await NodeFSP.writeFile(NodePath.join(staged, "version"), "new");
      await replaceApp(staged, target, previous);
      expect(await NodeFSP.readFile(NodePath.join(target, "version"), "utf8")).toBe("new");
      expect(await NodeFSP.readFile(NodePath.join(previous, "version"), "utf8")).toBe("old");
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });
  it("restores the installed app when the second rename fails", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-rollback-"));
    try {
      const target = NodePath.join(root, "installed.app");
      const staged = NodePath.join(root, "staged.app");
      await NodeFSP.mkdir(target);
      await NodeFSP.mkdir(staged);
      await NodeFSP.writeFile(NodePath.join(target, "version"), "old");
      await expect(
        replaceApp(staged, target, NodePath.join(root, "previous.app"), (from, to) => {
          if (from === staged) return Promise.reject(new Error("disk error"));
          return NodeFSP.rename(from, to);
        }),
      ).rejects.toThrow("disk error");
      expect(await NodeFSP.readFile(NodePath.join(target, "version"), "utf8")).toBe("old");
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });
});
