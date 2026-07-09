// ---------------------------------------------------------------------------
// w04-update addition — REAL x402 payment gate on Base Sepolia.
//
// Frutero's original stage 4 only verified the fixture signature string
// ("x402-fixture-paid"). This module wires the official x402 middleware so
// POST /jobs can require and settle a REAL testnet USDC payment:
//
//   - createLiveX402Middleware()  builds the @x402/hono paymentMiddleware
//     for POST /jobs: it answers 402 with a machine-readable invoice, then
//     verifies the EIP-3009 signature and settles it through the public
//     facilitator (the facilitator submits the onchain tx and pays gas).
//   - livePaymentMode()           the mode summary shown by /payment-mode
//     and /services (live?, ready?, network, facilitator).
//
// The seller address comes from AGENT_PRIVATE_KEY (derived) or X402_PAY_TO.
// jobs.ts only decides WHEN to apply the middleware (gate switch ON + live
// mode); everything about HOW the live payment works lives here.
// ---------------------------------------------------------------------------
import { HTTPFacilitatorClient, x402ResourceServer, type RoutesConfig } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware } from "@x402/hono";
import type { MiddlewareHandler } from "hono";
import {
  x402FacilitatorUrl,
  x402LiveReady,
  x402ModeLabel,
  x402Network,
  x402PayTo,
  x402Price,
  x402UsesLiveBaseSepolia
} from "./x402.js";
import type { AppConfig } from "../types.js";

export function livePaymentMode(config: AppConfig) {
  return {
    label: x402ModeLabel(config),
    live: x402UsesLiveBaseSepolia(config),
    ready: x402LiveReady(config),
    network: x402Network(config),
    facilitator: x402FacilitatorUrl(config),
    payToConfigured: Boolean(x402PayTo(config, "").trim())
  };
}

export function createLiveX402Middleware(config: AppConfig): MiddlewareHandler | null {
  // The seller address comes from AGENT_PRIVATE_KEY (derived) or X402_PAY_TO.
  const payTo = x402PayTo(config, "").trim();
  if (!x402UsesLiveBaseSepolia(config) || !payTo) return null;

  const network = x402Network(config) as Network;
  const facilitatorClient = new HTTPFacilitatorClient({
    url: x402FacilitatorUrl(config)
  });
  const resourceServer = new x402ResourceServer(facilitatorClient).register(network, new ExactEvmScheme());
  const routes: RoutesConfig = {
    "POST /jobs": {
      accepts: {
        scheme: "exact",
        price: x402Price(config, "$0.001"),
        network,
        payTo,
        maxTimeoutSeconds: 120
      },
      description: "Run a Mentor Agent job through the AI x Blockchain Day Base Sepolia x402 test.",
      mimeType: "application/json",
      serviceName: "AI x Blockchain Day Mentor Agent",
      unpaidResponseBody: () => ({
        contentType: "application/json",
        body: {
          ok: false,
          status: "payment_required",
          protocol: "x402",
          integration: "base-sepolia-live",
          network,
          facilitator: x402FacilitatorUrl(config),
          message: "This live Base Sepolia test requires an x402 payment signature."
        }
      })
    }
  };

  return paymentMiddleware(routes, resourceServer);
}
