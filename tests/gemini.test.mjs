import test from "node:test";
import assert from "node:assert/strict";
import { parseGeminiResponse } from "../src/adapters/gemini.mjs";

test("Gemini parser extracts text and usage metadata", () => {
  const selection = {
    provider: "google",
    model: "gemini-4-argon",
    api_model: "gemini-4-argon",
    account: "google_default"
  };
  const body = {
    candidates: [
      {
        content: {
          parts: [{ text: "Solução arquitetada com Gemini 4 Argon." }],
          role: "model"
        },
        finishReason: "STOP"
      }
    ],
    usageMetadata: {
      promptTokenCount: 150,
      candidatesTokenCount: 80,
      totalTokenCount: 230
    }
  };

  const parsed = parseGeminiResponse(body, selection, 450, "req-gemini-123");
  assert.equal(parsed.provider, "google");
  assert.equal(parsed.model, "gemini-4-argon");
  assert.equal(parsed.text, "Solução arquitetada com Gemini 4 Argon.");
  assert.equal(parsed.usage.input_tokens, 150);
  assert.equal(parsed.usage.output_tokens, 80);
  assert.equal(parsed.duration_ms, 450);
  assert.equal(parsed.request_id, "req-gemini-123");
  assert.equal(parsed.response_only, true);
});

test("Gemini parser handles output token exhaustion explicitly", () => {
  const selection = {
    provider: "google",
    model: "gemini-4-hydrogen",
    api_model: "gemini-4-hydrogen",
    account: "google_default"
  };
  const body = {
    candidates: [
      {
        content: { parts: [] },
        finishReason: "MAX_TOKENS"
      }
    ]
  };

  assert.throws(
    () => parseGeminiResponse(body, selection, 120),
    (err) => err.code === "GEMINI_OUTPUT_TRUNCATED"
  );
});

test("Gemini adapter sends the API key only in the x-goog-api-key header", async () => {
  const { invokeGemini } = await import("../src/adapters/gemini.mjs");
  const secret = "test-gemini-key-SHOULD-NOT-LEAK";
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "PONG" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await invokeGemini({
    selection: { provider: "google", model: "gemini-2.5-flash", api_model: "gemini-2.5-flash", account: "google_default" },
    prompt: "ping",
    provider: { base_url: "https://generativelanguage.googleapis.com", allowed_hosts: ["generativelanguage.googleapis.com"], secret_ref: "env:GEMINI_API_KEY" },
    timeoutMs: 5000,
    secretReader: async () => secret,
    fetchImpl
  });
  assert.equal(result.text, "PONG");
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.search, "");
  assert.ok(!calls[0].url.includes(secret));
  assert.equal(url.pathname, "/v1beta/models/gemini-2.5-flash:generateContent");
  assert.equal(calls[0].init.headers["x-goog-api-key"], secret);
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.ok(!calls[0].init.body.includes(secret));
});

test("Gemini HTTP and network errors never expose the API key", async () => {
  const { invokeGemini } = await import("../src/adapters/gemini.mjs");
  const { publicError } = await import("../src/errors.mjs");
  const secret = "test-gemini-key-SHOULD-NOT-LEAK";
  const base = {
    selection: { provider: "google", model: "gemini-2.5-flash", api_model: "gemini-2.5-flash", account: "google_default" },
    prompt: "ping",
    provider: { base_url: "https://generativelanguage.googleapis.com", allowed_hosts: ["generativelanguage.googleapis.com"], secret_ref: "env:GEMINI_API_KEY" },
    timeoutMs: 5000,
    secretReader: async () => secret
  };
  const failures = [
    async () => new Response(JSON.stringify({ error: { message: `bad key ${secret}` } }), { status: 403 }),
    async (url) => { throw new TypeError(`fetch failed for ${url}`); }
  ];
  for (const fetchImpl of failures) {
    await assert.rejects(invokeGemini({ ...base, fetchImpl }), (err) => {
      const serialized = JSON.stringify(publicError(err)) + String(err.message) + String(err.cause?.message ?? "");
      assert.ok(!serialized.includes(secret), serialized);
      return true;
    });
  }
});
