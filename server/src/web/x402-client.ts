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

window.aixbWallet = {
  isConnected: () => currentAddress !== null,
  getAddress: () => currentAddress,
  getChainId: () => currentChainId,
  connectWallet,
  disconnectWallet,
  switchToBaseSepolia,
  payWithX402,
  onAccountChanged: (cb) => { onAccountChangedCb = cb; },
  onChainChanged: (cb) => { onChainChangedCb = cb; }
};

window.aixbSetLog = (fn: LogFn) => setLogger(fn);
