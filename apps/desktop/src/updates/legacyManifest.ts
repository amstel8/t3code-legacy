// @effect-diagnostics nodeBuiltinImport:off -- Ed25519 verification is the native release trust boundary.
import * as NodeCrypto from "node:crypto";

export interface LegacyManifest {
  schemaVersion: 1;
  version: string;
  tag: string;
  artifact: string;
  size: number;
  sha256: string;
  electron: string;
  arch: "x64";
  minOS: "12.0";
  sourceCommit: string;
  releaseNotes?: string;
}

const stableVersion = /^\d+\.\d+\.\d+$/;

export function isNewerLegacyVersion(candidate: string, current: string): boolean {
  if (!stableVersion.test(candidate) || !stableVersion.test(current)) return false;
  const next = candidate.split(".").map(Number);
  const previous = current.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if (next[index] !== previous[index]) return next[index]! > previous[index]!;
  }
  return false;
}

export function decodeLegacyManifest(raw: string, publicKey: string): LegacyManifest {
  if (raw.length > 256 * 1024) throw new Error("Update manifest is too large.");
  const envelope: unknown = JSON.parse(raw);
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    !("payload" in envelope) ||
    !("signature" in envelope) ||
    typeof envelope.payload !== "string" ||
    typeof envelope.signature !== "string"
  ) {
    throw new Error("Invalid signed update manifest.");
  }
  const payload = Buffer.from(envelope.payload, "base64");
  if (!NodeCrypto.verify(null, payload, publicKey, Buffer.from(envelope.signature, "base64"))) {
    throw new Error("Update manifest signature verification failed.");
  }
  const data: unknown = JSON.parse(payload.toString("utf8"));
  if (typeof data !== "object" || data === null) throw new Error("Invalid release metadata.");
  const value = data as Record<string, unknown>;
  if (
    value.schemaVersion !== 1 ||
    typeof value.version !== "string" ||
    !stableVersion.test(value.version) ||
    value.tag !== `v${value.version}-macos12` ||
    value.artifact !== `T3-Code-${value.version}-x64.zip` ||
    typeof value.size !== "number" ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0 ||
    value.size > 2 * 1024 ** 3 ||
    typeof value.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    typeof value.electron !== "string" ||
    !stableVersion.test(value.electron) ||
    value.arch !== "x64" ||
    value.minOS !== "12.0" ||
    typeof value.sourceCommit !== "string" ||
    !/^[a-f0-9]{40}$/.test(value.sourceCommit) ||
    (value.releaseNotes !== undefined && typeof value.releaseNotes !== "string")
  ) {
    throw new Error("Incompatible or invalid legacy release metadata.");
  }
  return value as unknown as LegacyManifest;
}
