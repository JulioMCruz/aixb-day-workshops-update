import type { AppConfig } from "../types.js";
import type { X402Verification } from "./x402.js";
// w04-update: the real Base Sepolia registry tag and all the onchain
// read/write code (lookup + register) live in erc8004-onchain.ts.
import { ERC8004_AGENT_REGISTRY_TAG } from "./erc8004-onchain.js";

type AgentService = {
  name: string;
  endpoint: string;
  version?: string;
};

// w04-update: exported so erc8004-onchain.ts can build the same JSON shape.
export type AgentRegistration = {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";
  name: string;
  description: string;
  image: string;
  services: AgentService[];
  x402Support: true;
  active: true;
  registrations: Array<{
    agentId: number;
    agentRegistry: string;
  }>;
  supportedTrust: string[];
};

export type Erc8004Feedback = {
  agentRegistry: string;
  agentId: number;
  clientAddress: string;
  createdAt: string;
  value: 100;
  valueDecimals: 0;
  tag1: "x402PaidJob";
  tag2: string;
  endpoint: "POST /jobs";
  proofOfPayment: {
    fromAddress: string;
    toAddress: string;
    chainId: string;
    txHash: string;
    network: string;
    facilitator: string;
  };
};

function publicBaseUrl(config: AppConfig): string {
  return config.env.PUBLIC_BASE_URL ?? `http://localhost:${config.port}`;
}

export function erc8004AgentId(config: AppConfig): number {
  const parsed = Number(config.env.ERC8004_AGENT_ID ?? "1");
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function erc8004AgentRegistry(config: AppConfig): string {
  // w04-update: the default is the real Base Sepolia IdentityRegistry
  // (the original used a placeholder address).
  return config.env.ERC8004_AGENT_REGISTRY ?? ERC8004_AGENT_REGISTRY_TAG;
}

export function createAgentRegistration(config: AppConfig): AgentRegistration {
  const baseUrl = publicBaseUrl(config);

  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "AI x Blockchain Day Mentor Agent",
    description:
      "A workshop Mentor Agent that exposes a web page, an API for agents, and an optional x402 payment gate.",
    image: `${baseUrl}/social/agent.png`,
    services: [
      {
        name: "web",
        endpoint: `${baseUrl}/`
      },
      {
        name: "API",
        endpoint: `${baseUrl}/mentor-agent`,
        version: "v1"
      },
      {
        name: "x402",
        endpoint: `${baseUrl}/jobs`,
        version: "fixture"
      }
    ],
    x402Support: true,
    active: true,
    registrations: [
      {
        agentId: erc8004AgentId(config),
        agentRegistry: erc8004AgentRegistry(config)
      }
    ],
    supportedTrust: ["reputation"]
  };
}

export function createFeedback({
  config,
  task,
  payment,
  createdAt
}: {
  config: AppConfig;
  task: string;
  payment: X402Verification;
  createdAt: string;
}): Erc8004Feedback {
  const chainId = payment.network.startsWith("eip155:") ? payment.network.replace("eip155:", "") : payment.network;
  const client = payment.integration === "x402-testnet" ? "x402-client" : "fixture-client";

  return {
    agentRegistry: erc8004AgentRegistry(config),
    agentId: erc8004AgentId(config),
    clientAddress: `${payment.network}:${client}`,
    createdAt,
    value: 100,
    valueDecimals: 0,
    tag1: "x402PaidJob",
    tag2: task,
    endpoint: "POST /jobs",
    proofOfPayment: {
      fromAddress: client,
      toAddress: payment.payTo,
      chainId,
      txHash: payment.signature,
      network: payment.network,
      facilitator: payment.facilitatorUrl
    }
  };
}
