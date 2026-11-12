import { RouterError } from "./errors.mjs";
import { runProcess } from "./process.mjs";

/**
 * Resolves a provider credential from a reference stored in the catalog:
 *   env:VAR_NAME   -> reads process.env.VAR_NAME (default, works everywhere)
 *   op://vault/... -> reads through the 1Password CLI (`op`), optional
 * Secrets are only kept in memory and never written to logs.
 */
export function isSecretRef(ref) {
  return typeof ref === "string" && (/^env:[A-Za-z_][A-Za-z0-9_]*$/.test(ref) || ref.startsWith("op://"));
}

export async function readSecret(secretRef, { run = runProcess, env = process.env } = {}) {
  if (!isSecretRef(secretRef)) {
    throw new RouterError("SECRET_REFERENCE_INVALID", "Provider secret reference is invalid");
  }
  if (secretRef.startsWith("env:")) {
    const value = (env[secretRef.slice(4)] ?? "").trim();
    if (!value) throw new RouterError("CREDENTIAL_READ_FAILED", `Environment variable ${secretRef.slice(4)} is not set`);
    return value;
  }
  const result = await run({
    command: "op",
    args: ["read", secretRef],
    input: "",
    timeoutMs: 15_000,
    maxBufferBytes: 64 * 1024
  });
  const secret = result.stdout.trim();
  if (result.code !== 0 || !secret) {
    throw new RouterError("CREDENTIAL_READ_FAILED", "Could not read provider credential from 1Password");
  }
  return secret;
}
