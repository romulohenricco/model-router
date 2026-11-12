import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { RouterError } from "./errors.mjs";

const DEFAULT_MAX_BUFFER = 8 * 1024 * 1024;

export function runProcess({
  command,
  args = [],
  input = "",
  cwd,
  env = process.env,
  timeoutMs = 300_000,
  maxBufferBytes = DEFAULT_MAX_BUFFER
}) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let timedOut = false;
    let overflowed = false;
    let settled = false;

    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    function collect(current, chunk) {
      const next = Buffer.concat([current, chunk]);
      if (next.length > maxBufferBytes) {
        overflowed = true;
        child.kill();
        return next.subarray(0, maxBufferBytes);
      }
      return next;
    }

    child.stdout.on("data", (chunk) => {
      stdout = collect(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = collect(stderr, chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new RouterError("PROCESS_START_FAILED", "Could not start provider process", { cause: error }));
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) {
        reject(new RouterError("PROCESS_TIMEOUT", "Provider process exceeded its timeout", { retryable: true }));
        return;
      }
      if (overflowed) {
        reject(new RouterError("PROCESS_OUTPUT_LIMIT", "Provider process exceeded the output limit"));
        return;
      }
      resolve({
        code,
        signal,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        durationMs: Math.round(performance.now() - started)
      });
    });

    child.stdin.on("error", () => {});
    child.stdin.end(input, "utf8");
  });
}
