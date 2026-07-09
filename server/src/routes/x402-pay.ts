import type { Context } from "hono";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { Network } from "@x402/core/types";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";
import type { AppConfig } from "../types.js";
import { requireStage, type App } from "../workshop-gates.js";
import { x402Network, x402PayTo } from "../integrations/x402.js";

type PayLogEntry = {
  at: string;
  level: "info" | "warn" | "error" | "ok";
  message: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function appendLog(log: PayLogEntry[], entry: Omit<PayLogEntry, "at">): PayLogEntry[] {
  log.push({ at: nowIso(), ...entry });
  return log;
}

function privateKey(value: string): `0x${string}` {
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("X402_BUYER_PRIVATE_KEY must be a 32-byte EVM private key.");
  }
  return normalized as `0x${string}`;
}

function requiredString(value: string | undefined, name: string): string {
  if (!value?.trim()) {
    throw new Error(`Missing ${name}. Add it to server/.env before calling /x402/pay.`);
  }
  return value.trim();
}

export function registerX402PayRoute(app: App, config: AppConfig): void {
  app.post("/x402/pay", async (c: Context) => {
    const unavailable = requireStage(c, config, 4);
    if (unavailable) return unavailable;

    const log: PayLogEntry[] = [];

    try {
      appendLog(log, { level: "info", message: "/x402/pay called from web" });

      if (config.env.X402_MODE !== "base-sepolia") {
        appendLog(log, { level: "error", message: "Server is not in X402_MODE=base-sepolia" });
        return c.json({ ok: false, log, error: "Set X402_MODE=base-sepolia before calling /x402/pay." }, 400);
      }

      const payTo = x402PayTo(config, "").trim();
      if (!payTo) {
        throw new Error("Missing agent wallet. Set AGENT_PRIVATE_KEY (or X402_PAY_TO) in server/.env before calling /x402/pay.");
      }
      appendLog(log, { level: "info", message: `Seller (agent wallet): ${payTo}` });

      const buyerKey = privateKey(requiredString(config.env.X402_BUYER_PRIVATE_KEY, "X402_BUYER_PRIVATE_KEY"));
      const account = privateKeyToAccount(buyerKey);
      appendLog(log, { level: "info", message: `Buyer wallet: ${account.address}` });

      const baseUrl = config.env.X402_TEST_BASE_URL ?? `http://localhost:${config.port}`;
      const network = x402Network(config) as Network;
      appendLog(log, { level: "info", message: `Network: ${network}` });

      appendLog(log, { level: "info", message: `Health check: GET ${baseUrl}/health` });
      const health = await fetch(`${baseUrl}/health`);
      appendLog(log, { level: "info", message: `Health: ${health.status}` });

      appendLog(log, { level: "info", message: "Enabling payment gate: POST /payment-mode {enabled:true}" });
      const modeRes = await fetch(`${baseUrl}/payment-mode`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true })
      });
      const modeData = await modeRes.json().catch(() => ({}));
      appendLog(log, {
        level: modeRes.ok ? "ok" : "error",
        message: `payment-mode: ${modeRes.status} mode=${modeData?.mode?.label ?? "?"}`
      });

      if (modeData?.mode?.live !== true || modeData?.mode?.ready !== true) {
        return c.json(
          {
            ok: false,
            log,
            error: `Server is not ready for Base Sepolia x402 mode: ${JSON.stringify(modeData)}`
          },
          400
        );
      }

      const client = new x402Client();
      registerExactEvmScheme(client, {
        signer: account,
        networks: [network]
      });
      const httpClient = new x402HTTPClient(client);
      const fetchWithPayment = wrapFetchWithPayment(fetch, client);

      appendLog(log, { level: "info", message: "Calling /jobs without signature (expect 402)..." });
      const probe = await fetch(`${baseUrl}/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: "summarize", input: "AI x Blockchain Day demo." })
      });
      const probePaymentRequired = probe.headers.get("PAYMENT-REQUIRED");
      appendLog(log, {
        level: probe.status === 402 ? "ok" : "warn",
        message: `Probe response: ${probe.status} ${probePaymentRequired ? "with PAYMENT-REQUIRED header" : "no header"}`
      });

      if (probePaymentRequired) {
        try {
          const decoded = Buffer.from(probePaymentRequired, "base64").toString("utf8");
          const parsed = JSON.parse(decoded);
          appendLog(log, {
            level: "info",
            message: `Decoded PAYMENT-REQUIRED: scheme=${parsed?.accepts?.[0]?.scheme}, amount=${parsed?.accepts?.[0]?.amount}, payTo=${parsed?.accepts?.[0]?.payTo?.slice(0, 10)}...`
          });
        } catch {
          appendLog(log, { level: "warn", message: "Could not decode PAYMENT-REQUIRED header" });
        }
      }

      appendLog(log, { level: "info", message: "Signing EIP-3009 authorization (USDC transferWithAuthorization)..." });
      appendLog(log, { level: "info", message: "POST /jobs with PAYMENT-SIGNATURE header..." });

      const response = await fetchWithPayment(`${baseUrl}/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task: "summarize",
          input: "AI x Blockchain Day live x402 payment from web UI."
        })
      });

      appendLog(log, {
        level: response.ok ? "ok" : "error",
        message: `Final response: ${response.status} ${response.ok ? "settled" : "rejected"}`
      });

      const result = await httpClient.processResponse(response);
      const header = result.header as { transaction?: string; payer?: string; network?: string; success?: boolean } | null;

      if (header?.transaction) {
        appendLog(log, {
          level: "ok",
          message: `Tx settled onchain: ${header.transaction.slice(0, 20)}...`
        });
        appendLog(log, {
          level: "info",
          message: `BaseScan: https://sepolia.basescan.org/tx/${header.transaction}`
        });
      }
      if (header?.payer) {
        appendLog(log, { level: "info", message: `Payer confirmed: ${header.payer}` });
      }

      return c.json({
        ok: response.ok && result.paymentStatus === "settled",
        log,
        paymentStatus: result.paymentStatus,
        httpStatus: response.status,
        body: result.body,
        paymentHeader: header
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(log, { level: "error", message: `Exception: ${message}` });
      return c.json({ ok: false, log, error: message }, 500);
    }
  });
}
