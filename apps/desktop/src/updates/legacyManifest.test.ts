// @effect-diagnostics nodeBuiltinImport:off -- Isolated signing and filesystem fixtures for the native updater.
import * as NodeCrypto from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import { decodeLegacyManifest, isNewerLegacyVersion } from "./legacyManifest.ts";

const keys = NodeCrypto.generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const manifest = {
  schemaVersion: 1,
  version: "0.1.3",
  tag: "v0.1.3-macos12",
  artifact: "T3-Code-0.1.3-x64.zip",
  size: 1234,
  sha256: "a".repeat(64),
  electron: "45.0.0",
  arch: "x64",
  minOS: "12.0",
  sourceCommit: "b".repeat(40),
};
function envelope(value: unknown) {
  const payload = Buffer.from(JSON.stringify(value));
  return JSON.stringify({
    payload: payload.toString("base64"),
    signature: NodeCrypto.sign(null, payload, keys.privateKey).toString("base64"),
  });
}
describe("legacy release trust", () => {
  it("accepts a signed compatible release", () => {
    expect(decodeLegacyManifest(envelope(manifest), publicKey)).toEqual(manifest);
  });
  it("rejects modified release bytes and other signing keys", () => {
    const data = JSON.parse(envelope(manifest));
    data.payload = Buffer.from(JSON.stringify({ ...manifest, version: "9.0.0" })).toString(
      "base64",
    );
    expect(() => decodeLegacyManifest(JSON.stringify(data), publicKey)).toThrow();
    const other = NodeCrypto.generateKeyPairSync("ed25519")
      .publicKey.export({ type: "spki", format: "pem" })
      .toString();
    expect(() => decodeLegacyManifest(envelope(manifest), other)).toThrow();
  });
  it("rejects traversal, wrong architecture and mismatched version tags", () => {
    for (const patch of [
      { artifact: "../app.zip" },
      { arch: "arm64" },
      { tag: "v0.1.2-macos12" },
      { size: -1 },
      { sha256: "invalid" },
    ]) {
      expect(() => decodeLegacyManifest(envelope({ ...manifest, ...patch }), publicKey)).toThrow();
    }
  });
  it("compares numeric stable versions and refuses equal versions or downgrades", () => {
    expect(isNewerLegacyVersion("0.1.10", "0.1.9")).toBe(true);
    expect(isNewerLegacyVersion("0.1.3", "0.1.3")).toBe(false);
    expect(isNewerLegacyVersion("0.1.2", "0.1.3")).toBe(false);
    expect(isNewerLegacyVersion("0.1.4-beta", "0.1.3")).toBe(false);
  });
});
