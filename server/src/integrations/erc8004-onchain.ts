// ---------------------------------------------------------------------------
// w04-update addition — REAL ERC-8004 onchain identity (Base Sepolia).
//
// This file contains everything the w04-update branch added on top of
// Frutero's original erc8004.ts (which only builds fixture JSON documents):
//
//   - lookupAgent()          read the IdentityRegistry: is this wallet a
//                            registered agent? recover its agentId from the
//                            Registered event logs.
//   - buildSelfRegistrationURI()  build the eip-8004#registration-v1 JSON
//                            and embed it as an inline data: URI (no IPFS).
//   - serverRegisterAgent()  sign and send register(agentURI) with
//                            AGENT_PRIVATE_KEY — the agent wallet mints its
//                            own identity NFT and pays the (testnet) gas.
//
// The original fixture helpers (createAgentRegistration, createFeedback)
// stay untouched in erc8004.ts.
// ---------------------------------------------------------------------------
import {
  createPublicClient,
  http,
  encodeFunctionData,
  formatEther,
  parseAbiItem,
  getAddress,
  type Address,
  type Hex,
  isAddress
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import type { AppConfig } from "../types.js";
import type { AgentRegistration } from "./erc8004.js";

// ---------------------------------------------------------------------------
// ERC-8004 IdentityRegistry on Base Sepolia
// ---------------------------------------------------------------------------
// Source: https://github.com/agent0lab/subgraph (config/networks/base-sepolia.json)
// Address verified on 2026-07-09: contract name = "AgentIdentity", symbol = "AGENT"
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

// ---------------------------------------------------------------------------
// Onchain lookup: real read of IdentityRegistry on Base Sepolia.
// The registry on Base Sepolia does NOT expose tokenOfOwnerByIndex, so the
// canonical recovery path is to filter the Registered event logs by the
// owner topic. This works for any address that has ever self-registered
// an agent on the workshop chain.
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
// Encode the register(string) call data for `IdentityRegistry.register()`.
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

// Participant-facing step, replayed by the web UI in the activity log card.
// Messages are written for workshop participants: what happens, who signs,
// who pays gas, and where to verify it.
export type RegisterStep = {
  level: "info" | "ok" | "warn" | "error";
  message: string;
  url?: string;
  linkText?: string;
};

export async function serverRegisterAgent(
  config: AppConfig,
  onStep: (step: RegisterStep) => void = () => {}
): Promise<ServerRegisterResult> {
  const pk = config.env.AGENT_PRIVATE_KEY;
  if (!pk) {
    throw new Error("AGENT_PRIVATE_KEY not set in .env");
  }
  const normalized = pk.startsWith("0x") ? pk : `0x${pk}`;
  const account = privateKeyToAccount(normalized as `0x${string}`);
  const owner = account.address;
  const client = sharedPublicClient(config);
  const tokenUrl = `https://sepolia.basescan.org/token/${ERC8004_IDENTITY_REGISTRY_BASESEPOLIA}?a=${owner}`;

  onStep({
    level: "info",
    message: `Wallet del agente (seller): ${owner}. El server firma con AGENT_PRIVATE_KEY, tu MetaMask no participa.`
  });

  // 1. If the seller is already registered, return the existing agentId.
  onStep({
    level: "info",
    message: "Paso 1/4: consultando el IdentityRegistry en Base Sepolia. ¿Esta wallet ya tiene identidad de agente?"
  });
  const existing = await lookupAgent(config, owner);
  if (existing.ok && existing.registered && existing.agentId !== null) {
    onStep({
      level: "ok",
      message: `Ya estaba registrada como agentId #${existing.agentId}. El registro es idempotente: no se envía otra tx y no se gasta gas.`,
      url: tokenUrl,
      linkText: "ver NFT en BaseScan"
    });
    return {
      agentId: existing.agentId,
      txHash: existing.registrationTxHash ?? "0x0",
      agentURI: existing.agentURI ?? "",
      owner,
      alreadyRegistered: true
    };
  }
  onStep({ level: "ok", message: "No registrada todavía. Vamos a crear la identidad onchain." });

  // 2. Build the registration URI with the seller as owner.
  const agentURI = buildSelfRegistrationURI(config, owner);
  // Patch registrations[].agentId to 0 explicitly (kept for the schema).
  // We can't fill the real agentId until after the tx mines, but the
  // log + lookup output will surface the real one.
  const callData = encodeRegisterCallData(agentURI);
  onStep({
    level: "info",
    message: `Paso 2/4: agentURI listo, un JSON con nombre, endpoints y soporte x402 del agente, embebido como data: URI (${agentURI.length} caracteres, sin IPFS ni hosting).`
  });

  // 3. Send the tx from the seller wallet.
  onStep({
    level: "info",
    message: `Paso 3/4: enviando la tx register(agentURI) al IdentityRegistry ${ERC8004_IDENTITY_REGISTRY_BASESEPOLIA.slice(0, 10)}... La wallet del agente paga el gas (testnet).`
  });
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
  onStep({
    level: "ok",
    message: `Tx enviada: ${txHash.slice(0, 18)}... Esperando confirmación del bloque.`,
    url: `https://sepolia.basescan.org/tx/${txHash}`,
    linkText: "ver tx en BaseScan"
  });

  // 4. Wait for the receipt.
  const receipt = await client.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    onStep({ level: "error", message: `La tx se revirtió onchain: ${txHash}` });
    throw new Error(`register tx reverted: ${txHash}`);
  }
  const gasEth = formatEther(receipt.gasUsed * receipt.effectiveGasPrice);
  onStep({
    level: "ok",
    message: `Confirmada en el bloque ${receipt.blockNumber}. Costo real: ${receipt.gasUsed} gas, ${gasEth} ETH de testnet.`
  });

  // 5. Look up the new agentId by scanning the Registered event logs
  //    emitted by this tx.
  const agentId = await findAgentIdInReceipt(config, receipt);
  onStep({
    level: "ok",
    message: `Paso 4/4: evento Registered leído del receipt. agentId asignado: #${agentId}. El agente ya tiene su NFT de identidad ERC-8004 a nombre de su propia wallet.`,
    url: tokenUrl,
    linkText: "ver NFT en BaseScan"
  });
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
  // Fallback: re-scan the contract events at this block using the indexed
  // event signature (same shape as REGISTERED_EVENT above).
  const client = sharedPublicClient(config);
  const events = await client.getLogs({
    address: ERC8004_IDENTITY_REGISTRY_BASESEPOLIA,
    event: REGISTERED_EVENT,
    fromBlock: receipt.blockNumber,
    toBlock: receipt.blockNumber
  });
  if (events.length === 0) {
    throw new Error(`No Registered event found in tx ${receipt.transactionHash}`);
  }
  const match = events.find((e) => e.transactionHash === receipt.transactionHash) ?? events[0];
  const agentId = match.args.agentId;
  if (agentId === undefined) throw new Error("Event missing agentId");
  return Number(agentId);
}
