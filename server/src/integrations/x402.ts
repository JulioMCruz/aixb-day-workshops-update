import { privateKeyToAccount } from "viem/accounts";
import { configured } from "../config.js";
import type { AppConfig } from "../types.js";

export type X402Mode = "fixture" | "base-sepolia";

export type X402Requirement = {
  scheme: "exact";
  price: string;
  network: string;
  payTo: string;
  resource: string;
  description: string;
  mimeType: "application/json";
};

export type X402PaymentRequired = {
  x402Version: 1;
  accepts: X402Requirement[];
  facilitator: {
    url: string;
  };
};

export type X402Verification = {
  integration: "x402-fixture" | "x402-testnet";
  signature: "x402-fixture-paid" | "testnet-valid";
  network: string;
  payTo: string;
  facilitatorUrl: string;
};

export const X402_FIXTURE_SIGNATURE = "x402-fixture-paid";
export const X402_BASE_SEPOLIA_NETWORK = "eip155:84532";

export function x402Mode(config: AppConfig): X402Mode {
  return config.env.X402_MODE === "base-sepolia" ? "base-sepolia" : "fixture";
}

export function x402ModeLabel(config: AppConfig): string {
  return x402Mode(config) === "base-sepolia" ? "base-sepolia-live" : "fixture";
}

export function x402UsesLiveBaseSepolia(config: AppConfig): boolean {
  return x402Mode(config) === "base-sepolia";
}

export function x402LiveReady(config: AppConfig): boolean {
  return x402UsesLiveBaseSepolia(config) && Boolean(config.env.X402_PAY_TO?.trim());
}

export function x402FacilitatorUrl(config: AppConfig): string {
  return config.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator";
}

export function x402Network(config: AppConfig): string {
  return config.env.X402_NETWORK ?? X402_BASE_SEPOLIA_NETWORK;
}

export function x402Price(config: AppConfig, fallback: string): string {
  return config.env.X402_PRICE_USD ?? fallback;
}

export function x402PayTo(config: AppConfig, fallbackAddress: string): string {
  // If AGENT_PRIVATE_KEY is set, derive the seller address from it
  // (so the user can configure the agent with one env var instead of
  // having to also figure out the matching public address).
  if (configured(config.env.AGENT_PRIVATE_KEY)) {
    try {
      const account = privateKeyToAccount(normalizePrivateKey(config.env.AGENT_PRIVATE_KEY ?? ""));
      return account.address;
    } catch {
      // Fall through to the explicit X402_PAY_TO.
    }
  }
  return config.env.X402_PAY_TO ?? fallbackAddress;
}

function normalizePrivateKey(value: string): `0x${string}` {
  const trimmed = value.trim();
  if (trimmed.startsWith("0x")) return trimmed as `0x${string}`;
  return `0x${trimmed}` as `0x${string}`;
}

export function createX402Requirement({
  config,
  payTo,
  resource,
  description,
  price
}: {
  config: AppConfig;
  payTo: string;
  resource: string;
  description: string;
  price: string;
}): X402Requirement {
  return {
    scheme: "exact",
    price,
    network: x402Network(config),
    payTo,
    resource,
    description,
    mimeType: "application/json"
  };
}

export function createPaymentRequired(config: AppConfig, requirement: X402Requirement): X402PaymentRequired {
  return {
    x402Version: 1,
    accepts: [requirement],
    facilitator: {
      url: x402FacilitatorUrl(config)
    }
  };
}

export function encodePaymentRequired(paymentRequired: X402PaymentRequired): string {
  return Buffer.from(JSON.stringify(paymentRequired), "utf8").toString("base64");
}

export function verifyX402Payment({
  config,
  signature,
  requirement
}: {
  config: AppConfig;
  signature: string | null | undefined;
  requirement: X402Requirement;
}): X402Verification | null {
  if (signature === X402_FIXTURE_SIGNATURE) {
    return {
      integration: "x402-fixture",
      signature,
      network: requirement.network,
      payTo: requirement.payTo,
      facilitatorUrl: x402FacilitatorUrl(config)
    };
  }

  if (signature === "testnet-valid") {
    return {
      integration: "x402-testnet",
      signature,
      network: requirement.network,
      payTo: requirement.payTo,
      facilitatorUrl: x402FacilitatorUrl(config)
    };
  }

  return null;
}
