import { callLLM, type LLMRequest } from "./llm.js";
import type { AppConfig, NebiusResult } from "../types.js";

/**
 * w04-update: callNebius keeps its original name and signature (brain.ts
 * and services/mentor-agent.ts call it), but the implementation moved to
 * the callLLM cascade in llm.ts so the demo never falls over when a
 * provider is down. Without any LLM key it returns the fixture text,
 * exactly like Frutero's original behaviour.
 */
export async function callNebius(config: AppConfig, request: LLMRequest): Promise<NebiusResult> {
  const { warnings: _warnings, ...rest } = await callLLM(config, request);
  void _warnings;
  return rest;
}
