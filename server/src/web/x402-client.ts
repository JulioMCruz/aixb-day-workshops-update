// Browser-side x402 client. Bundled with esbuild → public/x402-client.js.
// Loaded by the workshop web UI when the user clicks "Connect wallet".

import { createWalletClient, custom, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";

type LogLevel = "info" | "ok" | "warn" | "error";
type LogLink = { url: string; text: string };
type LogFn = (level: LogLevel, message: string, link?: LogLink) => void;

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
      isMetaMask?: boolean;
    };
    aixbWallet?: {
      isConnected: () => boolean;
      getAddress: () => Address | null;
      getChainId: () => number | null;
      connectWallet: () => Promise<{ address: Address; chainId: number }>;
      disconnectWallet: () => void;
      switchToBaseSepolia: () => Promise<void>;
      payWithX402: (task: string, input: string) => Promise<{
        ok: boolean;
        status: number;
        txHash: string | null;
        network: string | null;
        receipt: unknown;
        body: unknown;
        error?: string;
      }>;
      lookupAgent8004: (address: Address) => Promise<{
        ok: boolean;
        registered: boolean;
        agentId: number | null;
        agentURI: string | null;
        baseScanToken: string | null;
        selfRegistrationURI: string | null;
        error?: string;
      }>;
      registerAgent8004: () => Promise<{
        ok: boolean;
        txHash: string | null;
        agentId: number | null;
        baseScanToken: string | null;
        error?: string;
      }>;
      onAccountChanged: (cb: (address: Address | null) => void) => void;
      onChainChanged: (cb: (chainId: number) => void) => void;
    };
    aixbSetLog?: (fn: LogFn) => void;
  }
}

const BASE_SEPOLIA_CHAIN_ID = 84532;
const BASE_SEPOLIA_HEX = "0x14a34";

let walletClient: ReturnType<typeof createWalletClient> | null = null;
let currentAddress: Address | null = null;
let currentChainId: number | null = null;
let log: LogFn = (level, message) => console.log(`[${level}] ${message}`);

let onAccountChangedCb: ((address: Address | null) => void) | null = null;
let onChainChangedCb: ((chainId: number) => void) | null = null;

function setLogger(fn: LogFn): void {
  log = fn;
}

async function connectWallet(): Promise<{ address: Address; chainId: number }> {
  if (!window.ethereum) {
    throw new Error("No se detectó wallet EIP-1193 (MetaMask, Coinbase Wallet, Rabby, etc.). Instalá una e intentá de nuevo.");
  }

  walletClient = createWalletClient({
    chain: baseSepolia,
    transport: custom(window.ethereum as never)
  });

  log("info", "Solicitando conexión al wallet...");
  const addresses = await walletClient.requestAddresses();
  const address = addresses[0];
  if (!address) {
    throw new Error("El wallet no devolvió ninguna dirección. Aceptá la conexión en el popup.");
  }
  currentAddress = address;
  log("ok", `Wallet conectada: ${address}`);

  const chainId = await getChainId();
  if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
    log("warn", `Red actual: ${chainId} (no es Base Sepolia ${BASE_SEPOLIA_CHAIN_ID}). Usá 'Switch to Base Sepolia'.`);
  } else {
    log("ok", `Red correcta: Base Sepolia (${chainId})`);
  }

  registerListeners();
  if (onAccountChangedCb) onAccountChangedCb(address);
  if (onChainChangedCb) onChainChangedCb(chainId);

  return { address, chainId };
}

function disconnectWallet(): void {
  walletClient = null;
  currentAddress = null;
  currentChainId = null;
  if (onAccountChangedCb) onAccountChangedCb(null);
  log("info", "Wallet desconectada");
}

async function getChainId(): Promise<number> {
  if (!window.ethereum) throw new Error("No wallet");
  const chainIdHex = (await window.ethereum.request({ method: "eth_chainId" })) as string;
  currentChainId = parseInt(chainIdHex, 16);
  return currentChainId;
}

async function switchToBaseSepolia(): Promise<void> {
  if (!window.ethereum) throw new Error("No wallet");
  try {
    log("info", "Solicitando cambio a Base Sepolia...");
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_SEPOLIA_HEX }]
    });
    log("ok", "Cambio a Base Sepolia OK");
  } catch (switchError) {
    const err = switchError as { code?: number };
    if (err.code === 4902) {
      log("info", "Base Sepolia no está en el wallet, agregando...");
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: BASE_SEPOLIA_HEX,
            chainName: "Base Sepolia",
            nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://sepolia.base.org"],
            blockExplorerUrls: ["https://sepolia.basescan.org"]
          }
        ]
      });
      log("ok", "Base Sepolia agregada al wallet");
    } else {
      throw switchError;
    }
  }
  currentChainId = await getChainId();
  if (onChainChangedCb) onChainChangedCb(currentChainId);
}

function registerListeners(): void {
  const eth = window.ethereum;
  if (!eth || typeof eth.on !== "function") return;
  const onFn: (event: string, handler: (...args: unknown[]) => void) => void = eth.on.bind(eth);

  onFn("accountsChanged", (...args: unknown[]) => {
    const accounts = args[0] as Address[] | undefined;
    currentAddress = accounts && accounts[0] ? accounts[0] : null;
    log("info", `Cuenta cambiada: ${currentAddress ?? "(desconectada)"}`);
    if (onAccountChangedCb) onAccountChangedCb(currentAddress);
  });

  onFn("chainChanged", (...args: unknown[]) => {
    const chainIdHex = args[0] as string;
    currentChainId = parseInt(chainIdHex, 16);
    log("info", `Red cambiada: ${currentChainId}`);
    if (onChainChangedCb) onChainChangedCb(currentChainId);
  });
}

async function payWithX402(task: string, input: string): Promise<{
  ok: boolean;
  status: number;
  txHash: string | null;
  network: string | null;
  receipt: unknown;
  body: unknown;
  error?: string;
}> {
  if (!walletClient || !currentAddress) {
    throw new Error("Wallet no conectada. Hacé click en 'Connect wallet' primero.");
  }
  if (currentChainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(`Red incorrecta (${currentChainId}). Cambiá a Base Sepolia primero.`);
  }

  log("info", "Armando signer EIP-3009 con el wallet del usuario...");
  const wc = walletClient;
  if (!wc) {
    throw new Error("Wallet no disponible");
  }
  const walletAccount = wc.account ?? currentAddress;
  const signer = toClientEvmSigner(
    {
      address: currentAddress,
      signTypedData: (msg) =>
        wc.signTypedData({
          account: walletAccount as never,
          domain: msg.domain,
          types: msg.types,
          primaryType: msg.primaryType,
          message: msg.message
        } as never) as Promise<`0x${string}`>
    },
    undefined
  );

  const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [
      {
        network: "eip155:84532",
        client: new ExactEvmScheme(signer)
      }
    ]
  });

  log("info", "POST /jobs sin firma (esperando 402)...");
  const initial = await fetch("/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task, input })
  });
  log(initial.status === 402 ? "ok" : "info", `Initial: ${initial.status} (esperábamos 402)`);

  log("info", "Firmando EIP-3009 con tu wallet y reenviando al facilitator...");
  const response = await fetchWithPayment("/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task, input })
  });

  const status = response.status;
  log(status === 201 ? "ok" : "warn", `Final response: ${status} ${response.statusText}`);

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  let txHash: string | null = null;
  let network: string | null = null;

  const paymentResponse = response.headers.get("payment-response");
  if (paymentResponse) {
    try {
      const decoded = JSON.parse(atob(paymentResponse)) as {
        transaction?: string;
        network?: string;
        payer?: string;
      };
      if (decoded.transaction) {
        txHash = decoded.transaction;
        const baseScanUrl = `https://sepolia.basescan.org/tx/${decoded.transaction}`;
        log("ok", `Tx settled onchain: ${decoded.transaction.slice(0, 20)}...`, {
          url: baseScanUrl,
          text: "BaseScan ↗"
        });
      }
      if (decoded.network) network = decoded.network;
      if (decoded.payer) {
        log("info", `Payer (tu wallet): ${decoded.payer}`);
      }
    } catch (e) {
      log("warn", "No se pudo decodificar payment-response header");
    }
  }

  const bodyRecord = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const receipt = bodyRecord && typeof bodyRecord.receipt === "object" ? bodyRecord.receipt : null;
  const feedback = bodyRecord && typeof bodyRecord.erc8004Feedback === "object" ? bodyRecord.erc8004Feedback : null;

  if (feedback) {
    const fb = feedback as { value?: number; tag1?: string; proofOfPayment?: { txHash?: string } };
    const fbTx = fb.proofOfPayment?.txHash;
    const fbLink = fbTx ? { url: `https://sepolia.basescan.org/tx/${fbTx}`, text: "proof onchain ↗" } : undefined;
    log(
      "ok",
      `ERC-8004 feedback: value=${fb.value ?? "?"} tag1=${fb.tag1 ?? "?"} txHash=${fbTx?.slice(0, 20) ?? "?"}...`,
      fbLink
    );
  }

  if (status !== 201) {
    log("error", `Pago rechazado: status ${status}`);
  }

  return {
    ok: response.ok,
    status,
    txHash,
    network,
    receipt,
    body,
    error: response.ok ? undefined : `HTTP ${status}`
  };
}

// ERC-8004 IdentityRegistry on Base Sepolia.
// Same address as in src/integrations/erc8004.ts (agent0lab subgraph config).
// The browser uses this constant to build a `eth_sendTransaction` payload
// without round-tripping to the server for the registry address.
const ERC8004_IDENTITY_REGISTRY_BASESEPOLIA =
  "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;

// Minimal ABI for `register(string)` -> uint256 agentId.
const ERC8004_REGISTER_ABI = [
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }]
  }
] as const;

type Erc8004Lookup = {
  ok: boolean;
  registered: boolean;
  agentId: number | null;
  agentURI: string | null;
  baseScanToken: string | null;
  selfRegistrationURI: string | null;
  error?: string;
};

type Erc8004Register = {
  ok: boolean;
  txHash: string | null;
  agentId: number | null;
  baseScanToken: string | null;
  error?: string;
};

async function lookupAgent8004(address: Address): Promise<Erc8004Lookup> {
  log("info", `Consultando ERC-8004 IdentityRegistry para ${address.slice(0, 10)}...`);
  try {
    const res = await fetch(`/agents/${address}`);
    if (!res.ok) {
      const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
      const errMsg = errBody?.error ?? `HTTP ${res.status}`;
      log("error", `Lookup 8004 falló: ${errMsg}`);
      return {
        ok: false,
        registered: false,
        agentId: null,
        agentURI: null,
        baseScanToken: null,
        selfRegistrationURI: null,
        error: errMsg
      };
    }
    const data = (await res.json()) as {
      ok: boolean;
      registered: boolean;
      agentId: number | null;
      agentURI: string | null;
      baseScanToken: string;
      selfRegistrationURI: string | null;
    };

    if (data.registered) {
      const idText = data.agentId !== null ? `#${data.agentId}` : "(agentId no escaneado, ver BaseScan)";
      log("ok", `Agent ERC-8004 registrado: ${idText}`);
      const baseScanUrl = data.baseScanToken;
      log("ok", `Token on BaseScan`, { url: baseScanUrl, text: "ver NFT ↗" });
    } else {
      log("info", "Wallet sin registro ERC-8004. Hay que registrarse onchain.");
    }

    return {
      ok: true,
      registered: data.registered,
      agentId: data.agentId,
      agentURI: data.agentURI,
      baseScanToken: data.baseScanToken,
      selfRegistrationURI: data.selfRegistrationURI
    };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    log("error", `Lookup 8004 error: ${errMsg}`);
    return {
      ok: false,
      registered: false,
      agentId: null,
      agentURI: null,
      baseScanToken: null,
      selfRegistrationURI: null,
      error: errMsg
    };
  }
}

async function registerAgent8004(): Promise<Erc8004Register> {
  if (!currentAddress) {
    const err = "Wallet no conectada. Hacé click en 'Connect wallet' primero.";
    log("error", err);
    return { ok: false, txHash: null, agentId: null, baseScanToken: null, error: err };
  }
  if (currentChainId !== BASE_SEPOLIA_CHAIN_ID) {
    const err = `Red incorrecta (${currentChainId}). Cambiá a Base Sepolia primero.`;
    log("error", err);
    return { ok: false, txHash: null, agentId: null, baseScanToken: null, error: err };
  }
  if (!window.ethereum) {
    const err = "No se detectó wallet EIP-1193.";
    log("error", err);
    return { ok: false, txHash: null, agentId: null, baseScanToken: null, error: err };
  }

  // Step 1: ask the server for the agentURI we'd register with.
  log("info", "Pidiendo agentURI al servidor...");
  const lookup = await lookupAgent8004(currentAddress);
  if (!lookup.ok) {
    return { ok: false, txHash: null, agentId: null, baseScanToken: null, error: lookup.error };
  }
  if (lookup.registered) {
    log("info", "Tu wallet ya está registrada. No hace falta volver a hacerlo.");
    return {
      ok: true,
      txHash: null,
      agentId: lookup.agentId,
      baseScanToken: lookup.baseScanToken,
      error: "already registered"
    };
  }
  const agentURI = lookup.selfRegistrationURI;
  if (!agentURI) {
    const err = "El servidor no devolvió un selfRegistrationURI.";
    log("error", err);
    return { ok: false, txHash: null, agentId: null, baseScanToken: null, error: err };
  }
  log("info", `agentURI listo (length=${agentURI.length} chars)`);

  // Step 2: encode `register(string)` with viem so we can pass the call
  // data straight to eth_sendTransaction. Encoding locally avoids
  // shipping the full ABI to the browser for one function call.
  const { encodeFunctionData } = await import("viem");
  const callData = encodeFunctionData({
    abi: ERC8004_REGISTER_ABI,
    functionName: "register",
    args: [agentURI]
  });
  log("ok", `Call data encodeado (${callData.length / 2 - 1} bytes)`);

  // Step 3: send the transaction. The wallet will pop up for confirmation
  // and pay the gas from the user's own ETH balance.
  log("info", "Enviando tx al wallet (vas a ver el popup de MetaMask)...");
  const txHash = (await window.ethereum.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: currentAddress,
        to: ERC8004_IDENTITY_REGISTRY_BASESEPOLIA,
        data: callData,
        value: "0x0",
        chainId: BASE_SEPOLIA_HEX
      }
    ]
  })) as `0x${string}`;

  const baseScanTx = `https://sepolia.basescan.org/tx/${txHash}`;
  log("ok", `Tx enviada: ${txHash.slice(0, 20)}...`, { url: baseScanTx, text: "ver tx ↗" });

  // Step 4: poll the server until the agentId is visible (max 60s).
  log("info", "Esperando confirmación onchain (poll cada 2s)...");
  let agentId: number | null = null;
  for (let i = 0; i < 30 && agentId === null; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const after = await lookupAgent8004(currentAddress);
    if (after.ok && after.registered && after.agentId !== null) {
      agentId = after.agentId;
    }
  }

  if (agentId !== null) {
    const tokenUrl = `https://sepolia.basescan.org/token/${ERC8004_IDENTITY_REGISTRY_BASESEPOLIA}?a=${agentId}`;
    log("ok", `¡Agent registrado! agentId = ${agentId}`, { url: tokenUrl, text: "ver NFT ↗" });
    return {
      ok: true,
      txHash,
      agentId,
      baseScanToken: tokenUrl,
      error: undefined
    };
  }

  log("warn", "Tx enviada pero agentId no apareció tras 60s. Probá 'Check 8004' en unos segundos.");
  return {
    ok: true,
    txHash,
    agentId: null,
    baseScanToken: null,
    error: "timeout waiting for confirmation"
  };
}

window.aixbWallet = {
  isConnected: () => currentAddress !== null,
  getAddress: () => currentAddress,
  getChainId: () => currentChainId,
  connectWallet,
  disconnectWallet,
  switchToBaseSepolia,
  payWithX402,
  lookupAgent8004,
  registerAgent8004,
  onAccountChanged: (cb) => { onAccountChangedCb = cb; },
  onChainChanged: (cb) => { onChainChangedCb = cb; }
};

window.aixbSetLog = (fn: LogFn) => setLogger(fn);
