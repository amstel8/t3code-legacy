// @effect-diagnostics nodeBuiltinImport:off -- Isolated signing and filesystem fixtures for the native updater.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("electron", () => ({ app: { isPackaged: true, getVersion: () => "0.1.2" } }));
import { LegacyUpdater } from "./LegacyUpdater.ts";

const keys = NodeCrypto.generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const manifest = {
  schemaVersion: 1,
  version: "0.1.3",
  tag: "v0.1.3-macos12",
  artifact: "T3-Code-0.1.3-x64.zip",
  size: 4,
  sha256: "a".repeat(64),
  electron: "45.0.0",
  arch: "x64",
  minOS: "12.0",
  sourceCommit: "b".repeat(40),
};
function signed(value: unknown) {
  const payload = Buffer.from(JSON.stringify(value));
  return JSON.stringify({
    payload: payload.toString("base64"),
    signature: NodeCrypto.sign(null, payload, keys.privateKey).toString("base64"),
  });
}
let directory: string;
const originalResources = Object.getOwnPropertyDescriptor(process, "resourcesPath");
beforeEach(async () => {
  directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "legacy-update-test-"));
  const resources = NodePath.join(directory, "T3.app/Contents/Resources");
  await NodeFSP.mkdir(resources, { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(resources, "legacy-update-config.json"),
    JSON.stringify({ publicKey }),
  );
  Object.defineProperty(process, "resourcesPath", { configurable: true, value: resources });
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalResources) Object.defineProperty(process, "resourcesPath", originalResources);
  else Reflect.deleteProperty(process, "resourcesPath");
  await NodeFSP.rm(directory, { recursive: true, force: true });
});
describe("legacy in-app updater", () => {
  it("checks only the fork and emits a signed newer version", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(signed(manifest)));
    vi.stubGlobal("fetch", fetchMock);
    const updater = new LegacyUpdater();
    const available = vi.fn();
    updater.on("update-available", available);
    await updater.checkForUpdates();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://github.com/amstel8/t3code-legacy/releases/latest/download/legacy-update.json",
    );
    expect(available).toHaveBeenCalledWith(manifest);
  });
  it("treats releases without a manifest as unavailable and refuses downgrades", async () => {
    const updater = new LegacyUpdater();
    const available = vi.fn();
    const unavailable = vi.fn();
    updater.on("update-available", available);
    updater.on("update-not-available", unavailable);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 404 }))
        .mockResolvedValueOnce(
          new Response(
            signed({
              ...manifest,
              version: "0.1.1",
              tag: "v0.1.1-macos12",
              artifact: "T3-Code-0.1.1-x64.zip",
            }),
          ),
        ),
    );
    await updater.checkForUpdates();
    await updater.checkForUpdates();
    expect(available).not.toHaveBeenCalled();
    expect(unavailable).toHaveBeenCalledTimes(2);
  });
  it("keeps slow downloads active and discards corrupted data before installation", async () => {
    const deadlines: Array<{ after: number; controller: AbortController }> = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation((after) => {
      const controller = new AbortController();
      deadlines.push({ after, controller });
      return controller.signal;
    });
    const started = Promise.withResolvers<void>();
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let bodySignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(signed(manifest)))
        .mockImplementationOnce((_url: string, options: RequestInit) => {
          bodySignal = options.signal ?? undefined;
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              bodyController = controller;
              bodySignal?.addEventListener("abort", () => controller.error(bodySignal?.reason));
              started.resolve();
            },
          });
          return Promise.resolve(new Response(body));
        }),
    );
    const updater = new LegacyUpdater();
    const downloaded = vi.fn();
    updater.on("update-downloaded", downloaded);
    await updater.checkForUpdates();
    const download = updater.downloadUpdate();
    void download.catch(() => {});
    await started.promise;
    for (const deadline of deadlines) {
      if (deadline.after <= 16 * 60_000) {
        deadline.controller.abort(new DOMException("Download timed out", "TimeoutError"));
      }
    }
    expect(bodySignal?.aborted).toBe(false);
    bodyController?.enqueue(new TextEncoder().encode("bad!"));
    bodyController?.close();
    await expect(download).rejects.toThrow("checksum");
    expect(downloaded).not.toHaveBeenCalled();
    expect(await NodeFSP.readdir(directory)).toEqual(["T3.app"]);
    await expect(updater.quitAndInstall(true, true)).rejects.toThrow("No verified update");
  });
  it("refuses metadata with an invalid signature and oversized downloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ payload: Buffer.from("{}").toString("base64"), signature: "AAAA" }),
          ),
        ),
    );
    const updater = new LegacyUpdater();
    await expect(updater.checkForUpdates()).rejects.toThrow("signature");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(signed(manifest)))
        .mockResolvedValueOnce(new Response("oversized")),
    );
    await updater.checkForUpdates();
    await expect(updater.downloadUpdate()).rejects.toThrow("signed size");
    expect(await NodeFSP.readdir(directory)).toEqual(["T3.app"]);
  });
});
