import {
  createPublicClient,
  http,
  encodeFunctionData,
  parseAbiItem,
  getAddress,
  type Address,
  type Hex,
  isAddress
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import type { AppConfig } from "../types.js";
import type { X402Verification } from "./x402.js";

type AgentService = {
  name: string;
  endpoint: string;
  version?: string;
};

type AgentRegistration = {
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

// ---------------------------------------------------------------------------
// ERC-8004 IdentityRegistry on Base Sepolia
// ---------------------------------------------------------------------------
// Source: https://github.com/agent0lab/subgraph (config/networks/base-sepolia.json)
// Address verified on 2026-07-09: contract name = "AgentIdentity", symbol = "AGENT"
// PerkOS reference impl: /opt/perkos-standalone-agents/perky/workspace/ERC-8004-Workshop
//   examples/step-by-step/typescript/src/register-agent.ts
export const ERC8004_IDENTITY_REGISTRY_BASESEPOLIA =
  "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;
export const ERC8004_REPUTATION_REGISTRY_BASESEPOLIA =
  "0x8004B663056A597Dffe9eCcC1965A193B7388713" as const;
export const ERC8004_AGENT_REGISTRY_TAG = `eip155:84532:${ERC8004_IDENTITY_REGISTRY_BASESEPOLIA}`;

// Minimal ABI matching the onchain implementation. We keep this short so the
// bundle stays small and there is no risk of pulling a non-existent function
// (tokenOfOwnerByIndex is NOT present on Base Sepolia — the workshop uses
// balanceOf + getLogs(Registered) to recover the agentId).
const ERC8004_IDENTITY_ABI = [
  // ERC-721 metadata reads
  { name: "name", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  // ERC-721 standard reads
  { name: "ownerOf", type: "function", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] },
  { name: "tokenURI", type: "function", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "string" }] },
  // ERC-721 enumeration read
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  // ERC-8004 write path: register(string agentURI) -> agentId
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }]
  }
] as const;

// Registered(uint256 agentId, string agentURI, address owner)
const REGISTERED_EVENT = parseAbiItem(
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)"
);

function publicBaseUrl(config: AppConfig): string {
  return config.env.PUBLIC_BASE_URL ?? `http://localhost:${config.port}`;
}

function rpcUrlForBaseSepolia(config: AppConfig): string {
  return config.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
}

function sharedPublicClient(config: AppConfig) {
  return createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrlForBaseSepolia(config))
  });
}

export function erc8004AgentId(config: AppConfig): number {
  const parsed = Number(config.env.ERC8004_AGENT_ID ?? "1");
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function erc8004AgentRegistry(config: AppConfig): string {
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
      { name: "web", endpoint: `${baseUrl}/` },
      { name: "API", endpoint: `${baseUrl}/mentor-agent`, version: "v1" },
      { name: "x402", endpoint: `${baseUrl}/jobs`, version: "fixture" }
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

// ---------------------------------------------------------------------------
// Onchain lookup (Nivel 3): real read of IdentityRegistry on Base Sepolia.
// The registry on Base Sepolia does NOT expose tokenOfOwnerByIndex, so the
// canonical recovery path is to filter the Registered event logs by the
// owner topic from block 0. This works for any address that has ever
// self-registered an agent on the workshop chain.
// ---------------------------------------------------------------------------
export type AgentLookup = {
  ok: true;
  network: "base-sepolia";
  chainId: 84532;
  registry: Address;
  address: Address;
  registered: boolean;
  agentId: number | null;
  agentURI: string | null;
  baseScanToken: string;
  registrationTxHash: Hex | null;
} | {
  ok: false;
  error: string;
};

export async function lookupAgent(
  config: AppConfig,
  rawAddress: string
): Promise<AgentLookup> {
  if (!isAddress(rawAddress)) {
    return { ok: false, error: `Invalid address: ${rawAddress}` };
  }
  const address = getAddress(rawAddress) as Address;
  const client = sharedPublicClient(config);

  try {
    const balance = (await client.readContract({
      address: ERC8004_IDENTITY_REGISTRY_BASESEPOLIA,
      abi: ERC8004_IDENTITY_ABI,
      functionName: "balanceOf",
      args: [address]
    })) as bigint;

    if (balance === 0n) {
      return {
        ok: true,
        network: "base-sepolia",
        chainId: 84532,
        registry: ERC8004_IDENTITY_REGISTRY_BASESEPOLIA,
        address,
        registered: false,
        agentId: null,
        agentURI: null,
        baseScanToken: `https://sepolia.basescan.org/token/${ERC8004_IDENTITY_REGISTRY_BASESEPOLIA}?a=${address}`,
        registrationTxHash: null
      };
    }

    // balance > 0: scan Registered logs filtered by owner topic.
    // The public Base Sepolia RPC caps eth_getLogs at 2000 blocks per
    // request. For the workshop demo the student registers DURING the
    // talk, so the event is always in the most recent 2000 blocks. We
    // scan the latest 2000 first; if not found we walk backwards in
    // 2000-block chunks up to 100 chunks (~2 days) to cover any
    // pre-registered students. This bounds latency at <300ms for the
    // common case and ~3s for the worst case.
    const REGISTRY_DEPLOY_BLOCK = 37174254n;
    const chunkSize = 2000n;
    const maxChunks = 100n;
    const latestBlock = await client.getBlockNumber();
    let toBlock = latestBlock;
    let agentId = 0n;
    let agentURI: string | null = null;
    let registrationTxHash: Hex | null = null;
    let scanned = 0n;
    let foundChunk = false;

    while (toBlock > REGISTRY_DEPLOY_BLOCK && scanned < maxChunks) {
      const fromBlock = toBlock > chunkSize + REGISTRY_DEPLOY_BLOCK
        ? toBlock - chunkSize
        : REGISTRY_DEPLOY_BLOCK;
      const logs = await client.getLogs({
        address: ERC8004_IDENTITY_REGISTRY_BASESEPOLIA,
        event: REGISTERED_EVENT,
        args: { owner: address },
        fromBlock,
        toBlock
      });
      if (logs.length > 0) {
        const latest = logs[logs.length - 1];
        const parsedId = latest.args.agentId;
        if (parsedId !== undefined) {
          agentId = parsedId;
          agentURI = latest.args.agentURI ?? null;
          registrationTxHash = latest.transactionHash as Hex;
        }
        foundChunk = true;
        break;
      }
      if (fromBlock === REGISTRY_DEPLOY_BLOCK) break;
      toBlock = fromBlock;
      scanned += 1n;
    }
    // foundChunk is unused in the return value — the caller can tell
    // "found" by `agentId !== 0`. We still set the var so the loop has
    // a single early-exit and so future telemetry can use it.
    void foundChunk;

    // If we couldn't find the Registered log in our 200k-block window,
    // we still know the address has balance>0 (it's a registered agent),
    // we just don't have the agentId locally. Return null agentId so the
    // UI can show "registered, see BaseScan for agentId".
    if (agentId === 0n) {
      return {
        ok: true,
        network: "base-sepolia",
        chainId: 84532,
        registry: ERC8004_IDENTITY_REGISTRY_BASESEPOLIA,
        address,
        registered: true,
        agentId: null,
        agentURI: null,
        baseScanToken: `https://sepolia.basescan.org/token/${ERC8004_IDENTITY_REGISTRY_BASESEPOLIA}?a=${address}`,
        registrationTxHash: null
      };
    }

    return {
      ok: true,
      network: "base-sepolia",
      chainId: 84532,
      registry: ERC8004_IDENTITY_REGISTRY_BASESEPOLIA,
      address,
      registered: true,
      agentId: Number(agentId),
      agentURI: agentURI ?? null,
      baseScanToken: `https://sepolia.basescan.org/token/${ERC8004_IDENTITY_REGISTRY_BASESEPOLIA}?a=${address}`,
      registrationTxHash
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message.slice(0, 200) };
  }
}

// ---------------------------------------------------------------------------
// Build the agentURI payload that gets stored onchain at register() time.
// We embed the registration JSON as a data:application/json;base64 URL so
// the workshop is self-contained (no IPFS, no public host required). The
// ERC-8004 spec accepts data: URIs alongside https:// and ipfs://.
// ---------------------------------------------------------------------------
export function buildSelfRegistrationURI(config: AppConfig, owner: Address): string {
  const baseUrl = publicBaseUrl(config);
  const registration: AgentRegistration = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "AI x Blockchain Day Workshop Agent",
    description: `Self-registered agent at AI x Blockchain Day. Owner: ${owner}`,
    image: `${baseUrl}/social/agent.png`,
    services: [
      { name: "web", endpoint: `${baseUrl}/` },
      { name: "API", endpoint: `${baseUrl}/mentor-agent`, version: "v1" },
      { name: "x402", endpoint: `${baseUrl}/jobs`, version: "v1" }
    ],
    x402Support: true,
    active: true,
    registrations: [
      {
        agentId: 0,
        agentRegistry: ERC8004_AGENT_REGISTRY_TAG
      }
    ],
    supportedTrust: ["reputation"]
  };
  const json = JSON.stringify(registration);
  const b64 = Buffer.from(json, "utf8").toString("base64");
  return `data:application/json;base64,${b64}`;
}

// ---------------------------------------------------------------------------
// Encode the register(string) call so the browser wallet can send it.
// Returns 0x-prefixed hex call data for `IdentityRegistry.register(agentURI)`.
// The function selector is 0xef3b5c30 (computed by viem from the ABI).
// ---------------------------------------------------------------------------
export function encodeRegisterCallData(agentURI: string): Hex {
  return encodeFunctionData({
    abi: ERC8004_IDENTITY_ABI,
    functionName: "register",
    args: [agentURI]
  });
}

// ---------------------------------------------------------------------------
// Server-side register: AGENT_PRIVATE_KEY signs and sends the tx.
// Returns { agentId, txHash, agentURI, owner }.
// The owner is the seller (derived from AGENT_PRIVATE_KEY) and matches
// X402_PAY_TO. This way the ERC-8004 NFT owner is consistent with the
// x402 payment receiver — the agent owns its own identity, the user
// just pays x402 to use the service.
// ---------------------------------------------------------------------------
export interface ServerRegisterResult {
  agentId: number;
  txHash: Hex;
  agentURI: string;
  owner: Address;
  alreadyRegistered: boolean;
}

export async function serverRegisterAgent(config: AppConfig): Promise<ServerRegisterResult> {
  const pk = config.env.AGENT_PRIVATE_KEY;
  if (!pk) {
    throw new Error("AGENT_PRIVATE_KEY not set in .env");
  }
  const normalized = pk.startsWith("0x") ? pk : `0x${pk}`;
  const account = privateKeyToAccount(normalized as `0x${string}`);
  const owner = account.address;
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrlForBaseSepolia(config))
  });

  // 1. If the seller is already registered, return the existing agentId.
  const existing = await lookupAgent(config, owner);
  if (existing.ok && existing.registered && existing.agentId !== null) {
    return {
      agentId: existing.agentId,
      txHash: existing.registrationTxHash ?? "0x0",
      agentURI: existing.agentURI ?? "",
      owner,
      alreadyRegistered: true
    };
  }

  // 2. Build the registration URI with the seller as owner.
  const agentURI = buildSelfRegistrationURI(config, owner);
  // Patch registrations[].agentId to 0 explicitly (kept for the schema).
  // We can't fill the real agentId until after the tx mines, but the
  // log + lookup output will surface the real one.
  const callData = encodeRegisterCallData(agentURI);

  // 3. Send the tx from the seller wallet.
  const walletClient = await import("viem").then((m) =>
    m.createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(rpcUrlForBaseSepolia(config))
    })
  );
  const txHash = await walletClient.sendTransaction({
    to: ERC8004_IDENTITY_REGISTRY_BASESEPOLIA,
    data: callData,
    value: 0n,
    chain: baseSepolia
  });

  // 4. Wait for the receipt.
  const receipt = await client.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`register tx reverted: ${txHash}`);
  }

  // 5. Look up the new agentId by scanning the Registered event logs
  //    emitted by this tx.
  const agentId = await findAgentIdInReceipt(config, receipt);
  return {
    agentId,
    txHash,
    agentURI,
    owner,
    alreadyRegistered: false
  };
}

async function findAgentIdInReceipt(
  config: AppConfig,
  receipt: { blockNumber: bigint; transactionHash: Hex; logs: ReadonlyArray<{ address: Address; data: Hex; topics: readonly Hex[] }> }
): Promise<number> {
  // Registered(uint256 agentId, string agentURI, address owner) topic on Base Sepolia
  const REGISTERED_TOPIC = "0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a";
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== ERC8004_IDENTITY_REGISTRY_BASESEPOLIA.toLowerCase()) continue;
    if (log.topics.length < 3) continue;
    if (log.topics[0]?.toLowerCase() !== REGISTERED_TOPIC) continue;
    const agentIdHex = log.topics[1];
    if (!agentIdHex) continue;
    return Number(BigInt(agentIdHex));
  }
  // Fallback: re-scan the contract events at this block.
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrlForBaseSepolia(config))
  });
  const eventAbi = parseAbiItem("event Registered(uint256 agentId, string agentURI, address owner)");
  const events = await client.getLogs({
    address: ERC8004_IDENTITY_REGISTRY_BASESEPOLIA,
    events: [eventAbi],
    fromBlock: receipt.blockNumber,
    toBlock: receipt.blockNumber
  });
  if (events.length === 0) {
    throw new Error(`No Registered event found in tx ${receipt.transactionHash}`);
  }
  type RegisteredEvent = { transactionHash?: Hex; args?: { agentId?: bigint } };
  const list = events as unknown as RegisteredEvent[];
  const match = list.find((e) => e.transactionHash === receipt.transactionHash);
  const ev = match ?? list[0];
  if (!ev) throw new Error("No event match");
  const args = ev.args;
  if (!args || args.agentId === undefined) throw new Error("Event missing agentId");
  return Number(args.agentId);
}
