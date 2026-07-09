// ---------------------------------------------------------------------------
// w04-update addition — ERC-8004 agent identity routes.
//
// These endpoints expose the REAL onchain identity flow implemented in
// integrations/erc8004-onchain.ts:
//
//   GET  /agents/registry-info     registry address + BaseScan link
//   GET  /agents/:address          onchain lookup: registered? agentId?
//   POST /agents/register-server   AGENT_PRIVATE_KEY signs register() and
//                                  mints the agent's identity NFT; returns
//                                  a step-by-step log for the activity card
// ---------------------------------------------------------------------------
import {
  buildSelfRegistrationURI,
  lookupAgent,
  serverRegisterAgent,
  ERC8004_IDENTITY_REGISTRY_BASESEPOLIA,
  type RegisterStep
} from "../integrations/erc8004-onchain.js";
import type { AppConfig } from "../types.js";
import { requireStage, type App } from "../workshop-gates.js";

export function registerAgentIdentityRoutes(app: App, config: AppConfig): void {
  // Static helper for the workshop demo. Returns the IdentityRegistry address
  // so the UI can show it without an extra onchain round trip.
  // NOTE: this route must be registered BEFORE the parameterized :address
  // route, otherwise Hono matches "registry-info" as the address param.
  app.get("/agents/registry-info", (c) => {
    const unavailable = requireStage(c, config, 4);
    if (unavailable) return unavailable;

    return c.json({
      ok: true,
      registry: ERC8004_IDENTITY_REGISTRY_BASESEPOLIA,
      chainId: 84532,
      network: "base-sepolia",
      baseScanContract: `https://sepolia.basescan.org/address/${ERC8004_IDENTITY_REGISTRY_BASESEPOLIA}`
    });
  });

  // ERC-8004 onchain lookup. Reads the IdentityRegistry on Base Sepolia.
  // Used by the workshop UI to verify whether a wallet has self-registered
  // an agent identity. See erc8004-onchain.ts for the contract address.
  app.get("/agents/:address", async (c) => {
    const unavailable = requireStage(c, config, 4);
    if (unavailable) return unavailable;

    const raw = c.req.param("address");
    const result = await lookupAgent(config, raw);
    if (!result.ok) {
      return c.json({ ok: false, error: result.error }, 400);
    }
    return c.json({
      ok: true,
      network: result.network,
      chainId: result.chainId,
      registry: result.registry,
      address: result.address,
      registered: result.registered,
      agentId: result.agentId,
      agentURI: result.agentURI,
      baseScanToken: result.baseScanToken,
      registrationTxHash: result.registrationTxHash,
      // Pre-built data: URL with the agentURI the student can register with.
      // null when the student is already registered.
      selfRegistrationURI: result.registered
        ? null
        : buildSelfRegistrationURI(config, result.address)
    });
  });

  // Server-side agent registration: AGENT_PRIVATE_KEY signs and sends the
  // tx from the seller wallet. The resulting NFT owner is the seller, which
  // matches X402_PAY_TO. This is the "real" identity for the agent that
  // receives x402 payments.
  app.post("/agents/register-server", async (c) => {
    const unavailable = requireStage(c, config, 4);
    if (unavailable) return unavailable;
    // Step-by-step log replayed in the web activity card so participants
    // can follow what the server did on their behalf (same pattern as /x402/pay).
    const steps: RegisterStep[] = [];
    if (!config.env.AGENT_PRIVATE_KEY) {
      return c.json({ ok: false, error: "AGENT_PRIVATE_KEY not set in .env", log: steps }, 400);
    }
    try {
      const result = await serverRegisterAgent(config, (step) => steps.push(step));
      return c.json({
        ok: true,
        ...result,
        baseScanToken: `https://sepolia.basescan.org/token/${ERC8004_IDENTITY_REGISTRY_BASESEPOLIA}?a=${result.owner}`,
        log: steps
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: message, log: steps }, 500);
    }
  });
}
