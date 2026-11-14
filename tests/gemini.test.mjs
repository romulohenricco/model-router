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
