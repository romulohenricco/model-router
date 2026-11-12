import { RouterError } from "./errors.mjs";

export const VERIFIER_SYSTEM = [
  "You are an independent verifier operating in response-only mode.",
  "Compare the candidate with the original request.",
  "Return only one JSON object with verdict, summary, and corrected_response.",
  "verdict must be approve, revise, or reject.",
  "Use corrected_response only when verdict is revise; otherwise return null.",
  "Do not use tools or external context."
].join(" ");

export function buildVerifierPrompt(request, candidate) {
  return JSON.stringify({
    task: "Verify the candidate response against the original request.",
    output_contract: {
      verdict: "approve | revise | reject",
      summary: "short reason",
      corrected_response: "string when revise, otherwise null"
    },
    original_request: request,
    candidate_response: candidate
  });
}

function extractObject(text) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(trimmed);
  } catch {}
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new SyntaxError("No JSON object found");
}

export function parseVerifierResponse(text) {
  let value;
  try {
    value = extractObject(text);
  } catch (error) {
    throw new RouterError("VERIFIER_JSON_INVALID", "Verifier returned invalid JSON", { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RouterError("VERIFIER_JSON_INVALID", "Verifier returned a non-object JSON value");
  }
  if (!["approve", "revise", "reject"].includes(value.verdict)) {
    throw new RouterError("VERIFIER_VERDICT_INVALID", "Verifier returned an invalid verdict");
  }
  if (typeof value.summary !== "string" || !value.summary.trim()) {
    throw new RouterError("VERIFIER_SUMMARY_INVALID", "Verifier returned no summary");
  }
  if (value.verdict === "revise" && (typeof value.corrected_response !== "string" || !value.corrected_response.trim())) {
    throw new RouterError("VERIFIER_CORRECTION_MISSING", "Verifier requested revision without a corrected response");
  }
  return {
    verdict: value.verdict,
    summary: value.summary.trim(),
    corrected_response: value.verdict === "revise" ? value.corrected_response : null
  };
}
