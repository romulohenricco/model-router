import { RouterError } from "../errors.mjs";
import { invokeClaude } from "./claude.mjs";
import { invokeGlm } from "./glm.mjs";
import { invokeMiniMax } from "./minimax.mjs";
import { invokeOpenAI } from "./openai.mjs";

const ADAPTERS = {
  claude_cli: invokeClaude,
  codex_cli: invokeOpenAI,
  minimax_anthropic: invokeMiniMax,
  glm_openai: invokeGlm
};

export async function invokeModel({ selection, prompt, catalog, ...options }) {
  const provider = catalog.providers[selection.provider];
  const modelConfig = catalog.models[selection.model];
  const adapter = ADAPTERS[provider.adapter];
  if (!adapter) throw new RouterError("ADAPTER_UNKNOWN", "Provider adapter is not implemented");
  return adapter({
    selection,
    prompt,
    provider,
    modelConfig,
    timeoutMs: options.timeoutMs ?? provider.timeout_ms,
    maxOutputTokens: options.maxOutputTokens,
    systemPrompt: options.systemPrompt
  });
}
