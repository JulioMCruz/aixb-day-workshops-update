// ---------------------------------------------------------------------------
// w04-update addition — LLM cascade.
//
// Frutero's original nebius.ts called Nebius directly and fell back to a
// fixture. This module generalizes that into a provider cascade: it tries
// each configured OpenAI-compatible provider in order (Nebius first, Groq
// only if someone sets a GROQ_API_KEY — it is NOT required) and falls back
// to a deterministic local fixture, so the workshop demo never blocks on a
// missing or failing LLM key.
//
// callNebius() in nebius.ts keeps its original name and signature and
// delegates here, so the original routes (brain.ts, mentor-agent.ts) did
// not need to change.
// ---------------------------------------------------------------------------
import { configured } from "../config.js";
import { errorMessage } from "../http.js";
import type { AppConfig, NebiusResult } from "../types.js";

export type LLMRequest = {
  system: string;
  user: string;
  fixtureText: string;
};

type LLMProvider = "nebius-token-factory" | "groq" | "local-fixture";

type ChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

type ProviderConfig = {
  name: LLMProvider;
  apiKey: string;
  model: string;
  baseUrl: string;
};

function readProviders(config: AppConfig): ProviderConfig[] {
  const providers: ProviderConfig[] = [];

  if (configured(config.env.NEBIUS_API_KEY) && configured(config.env.NEBIUS_MODEL)) {
    providers.push({
      name: "nebius-token-factory",
      apiKey: config.env.NEBIUS_API_KEY ?? "",
      model: config.env.NEBIUS_MODEL ?? "",
      baseUrl: config.nebiusBaseUrl
    });
  }

  if (configured(config.env.GROQ_API_KEY) && configured(config.env.GROQ_MODEL)) {
    providers.push({
      name: "groq",
      apiKey: config.env.GROQ_API_KEY ?? "",
      model: config.env.GROQ_MODEL ?? "",
      baseUrl: config.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1"
    });
  }

  return providers;
}

async function callProvider(provider: ProviderConfig, request: LLMRequest): Promise<string> {
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${provider.name} returned ${response.status}: ${body}`);
  }

  const data = (await response.json()) as ChatResponse;
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Cascade reasoning call. Tries each configured provider in order, then
 * falls back to a local fixture so the workshop always returns something
 * useful. Captures per-provider failures in `warnings` so the response
 * stays transparent about which path actually produced the answer.
 */
export async function callLLM(config: AppConfig, request: LLMRequest): Promise<NebiusResult & { warnings: string[] }> {
  const providers = readProviders(config);
  const warnings: string[] = [];

  for (const provider of providers) {
    try {
      const text = await callProvider(provider, request);
      return {
        integration: "live",
        provider: provider.name,
        model: provider.model,
        text,
        warnings
      };
    } catch (error) {
      warnings.push(`${provider.name}: ${errorMessage(error)}`);
    }
  }

  return {
    integration: "fixture",
    provider: "local-fixture",
    text: request.fixtureText,
    warnings
  };
}
