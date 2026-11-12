export function estimateTokenCostUsd(usage, pricing) {
  if (!usage || !pricing) return null;
  const input = usage.input_tokens;
  const output = usage.output_tokens;
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;

  const cached = Number.isFinite(usage.cached_input_tokens)
    ? Math.min(Math.max(usage.cached_input_tokens, 0), input)
    : 0;
  const regularInput = input - cached;
  const total = (
    regularInput * pricing.input
    + cached * (pricing.cached_input ?? pricing.input)
    + output * pricing.output
  ) / 1_000_000;
  return Number(total.toFixed(8));
}

