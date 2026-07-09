import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { createAgentRegistration, createFeedback } from "../integrations/erc8004.js";
import { readWallet } from "../integrations/wallet.js";
// w04-update: the real Base Sepolia payment gate lives in x402-live.ts.
import { createLiveX402Middleware, livePaymentMode } from "../integrations/x402-live.js";
import {
  createPaymentRequired,
  createX402Requirement,
  encodePaymentRequired,
  verifyX402Payment,
  x402FacilitatorUrl,
  x402ModeLabel,
  x402Network,
  x402Price,
  x402PayTo,
  x402UsesLiveBaseSepolia,
  type X402Requirement
} from "../integrations/x402.js";
import type { AppConfig, JobRecord, WalletStatus } from "../types.js";
import { requireStage, type App } from "../workshop-gates.js";

type CreateJobBody = {
  task?: string;
  input?: string;
  paymentReceipt?: string | null;
};

type PaymentModeBody = {
  enabled?: boolean;
};

type PaidService = {
  id: "summarize" | "mentor";
  description: string;
  price: string;
  requirement: X402Requirement;
};

function fallbackPayTo(wallet: WalletStatus): string {
  return wallet.integration === "fixture" ? wallet.address : "0x0000000000000000000000000000000000000000";
}

function serviceCatalog(config: AppConfig, wallet: WalletStatus): PaidService[] {
  const payTo = x402PayTo(config, fallbackPayTo(wallet));

  return [
    {
      id: "summarize",
      description: "Summarize text after x402 payment authorization.",
      price: x402Price(config, "$0.001"),
      requirement: createX402Requirement({
        config,
        payTo,
        resource: "POST /jobs",
        description: "Run summarize job with Mentor Agent",
        price: x402Price(config, "$0.001")
      })
    },
    {
      id: "mentor",
      description: "Return a builder mentor next step after x402 payment authorization.",
      price: x402Price(config, "$0.002"),
      requirement: createX402Requirement({
        config,
        payTo,
        resource: "POST /jobs",
        description: "Run mentor job with Mentor Agent",
        price: x402Price(config, "$0.002")
      })
    }
  ];
}

function findService(services: PaidService[], task: string): PaidService {
  return services.find((service) => service.id === task) ?? services[0];
}

function executePaidTask({ task, input }: { task: string; input: string }): string {
  if (task === "summarize") {
    return `Summary: ${(input || "No input provided").slice(0, 160)}`;
  }

  if (task === "mentor") {
    return `Mentor result: define one small next step for ${input || "this project"}.`;
  }

  return `Executed fixture task "${task || "default"}" with input "${input || "none"}".`;
}

function paymentSignature(c: Context): string | undefined {
  return c.req.header("PAYMENT-SIGNATURE") ?? c.req.header("X-PAYMENT");
}

export function registerJobRoutes(app: App, config: AppConfig): void {
  const jobs = new Map<string, JobRecord>();
  let paymentsEnabled = false;
  const liveX402Middleware = createLiveX402Middleware(config);

  app.get("/.well-known/agent-registration.json", (c) => {
    const unavailable = requireStage(c, config, 4);
    if (unavailable) return unavailable;

    return c.json(createAgentRegistration(config));
  });

  app.get("/payment-mode", (c) => {
    const unavailable = requireStage(c, config, 4);
    if (unavailable) return unavailable;

    const mode = livePaymentMode(config);
    return c.json({
      workshop: 4,
      protocol: "x402",
      paymentsEnabled,
      mode,
      agentWallet: x402PayTo(config, "") || null,
      toggle: "POST /payment-mode",
      fixturePaymentSignature: "x402-fixture-paid"
    });
  });

  app.post("/payment-mode", async (c) => {
    const unavailable = requireStage(c, config, 4);
    if (unavailable) return unavailable;

    const body = (await c.req.json<PaymentModeBody>().catch(() => ({}))) as PaymentModeBody;
    paymentsEnabled = body.enabled === true;

    return c.json({
      workshop: 4,
      protocol: "x402",
      paymentsEnabled,
      mode: livePaymentMode(config),
      fixturePaymentSignature: "x402-fixture-paid"
    });
  });

  app.get("/services", async (c) => {
    const unavailable = requireStage(c, config, 4);
    if (unavailable) return unavailable;

    const wallet = await readWallet(config);
    const services = serviceCatalog(config, wallet);

    return c.json({
      workshop: 4,
      integration: x402ModeLabel(config),
      protocol: "x402",
      payments: {
        enabled: paymentsEnabled,
        toggle: "POST /payment-mode",
        mode: paymentsEnabled ? "enforced" : "demo-open",
        driver: livePaymentMode(config)
      },
      identity: {
        protocol: "ERC-8004",
        registration: "/.well-known/agent-registration.json",
        ...createAgentRegistration(config)
      },
      services: services.map((service) => ({
        id: service.id,
        price: service.price,
        payment: service.requirement,
        description: service.description
      }))
    });
  });

  app.use("/jobs", async (c, next) => {
    if (c.req.method !== "POST" || config.stage < 4 || !paymentsEnabled || !x402UsesLiveBaseSepolia(config)) {
      return next();
    }

    if (!liveX402Middleware) {
      return c.json(
        {
          ok: false,
          status: "x402_live_not_configured",
          protocol: "x402",
          integration: "base-sepolia-live",
          message: "Set AGENT_PRIVATE_KEY (or X402_PAY_TO) to the agent wallet before enabling Base Sepolia live mode."
        },
        500
      );
    }

    return liveX402Middleware(c, next);
  });

  app.post("/jobs", async (c) => {
    const unavailable = requireStage(c, config, 4);
    if (unavailable) return unavailable;

    const body = (await c.req.json<CreateJobBody>().catch(() => ({}))) as CreateJobBody;
    const task = body.task ?? "summarize";
    const input = body.input ?? "";
    const wallet = await readWallet(config);
    const services = serviceCatalog(config, wallet);
    const service = findService(services, task);
    const signature = paymentSignature(c) ?? body.paymentReceipt;

    if (!paymentsEnabled) {
      const id = randomUUID();
      const job: JobRecord = {
        id,
        status: "completed",
        integration: "payment-disabled",
        task,
        input,
        result: executePaidTask({ task, input }),
        payment: {
          enabled: false,
          protocol: "none",
          required: false
        },
        createdAt: new Date().toISOString()
      };

      jobs.set(id, job);
      return c.json(job, 201);
    }

    if (x402UsesLiveBaseSepolia(config)) {
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      const payment = {
        integration: "x402-testnet" as const,
        signature: "testnet-valid" as const,
        network: x402Network(config),
        payTo: x402PayTo(config, fallbackPayTo(wallet)),
        facilitatorUrl: x402FacilitatorUrl(config)
      };
      const job: JobRecord = {
        id,
        status: "completed",
        integration: "x402-testnet",
        task,
        input,
        result: executePaidTask({ task, input }),
        payment: {
          enabled: true,
          protocol: "x402",
          required: true
        },
        receipt: {
          protocol: "x402",
          type: "testnet",
          value: payment.signature,
          network: payment.network,
          payTo: payment.payTo,
          facilitator: payment.facilitatorUrl,
          verified: true
        },
        erc8004Feedback: createFeedback({
          config,
          task,
          payment,
          createdAt
        }),
        createdAt
      };

      jobs.set(id, job);
      return c.json(job, 201);
    }

    const payment = verifyX402Payment({
      config,
      signature,
      requirement: service.requirement
    });

    if (!payment) {
      const paymentRequired = createPaymentRequired(config, service.requirement);
      c.header("PAYMENT-REQUIRED", encodePaymentRequired(paymentRequired));

      return c.json(
        {
          ok: false,
          status: "payment_required",
          protocol: "x402",
          integration: "x402-fixture",
          paymentRequired,
          fixturePaymentSignature: "x402-fixture-paid",
          message: "This agent service only executes after an x402 payment signature."
        },
        402
      );
    }

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const job: JobRecord = {
      id,
      status: "completed",
      integration: payment.integration,
      task,
      input,
      result: executePaidTask({ task, input }),
      payment: {
        enabled: true,
        protocol: "x402",
        required: true
      },
      receipt: {
        protocol: "x402",
        type: payment.signature === "testnet-valid" ? "testnet" : "fixture",
        value: payment.signature,
        network: payment.network,
        payTo: payment.payTo,
        facilitator: payment.facilitatorUrl,
        verified: true
      },
      erc8004Feedback: createFeedback({
        config,
        task,
        payment,
        createdAt
      }),
      createdAt
    };

    jobs.set(id, job);
    return c.json(job, 201);
  });

  app.get("/jobs/:id", (c) => {
    const unavailable = requireStage(c, config, 4);
    if (unavailable) return unavailable;

    const job = jobs.get(c.req.param("id"));
    if (!job) {
      return c.json({ ok: false, message: "Job not found in this in-memory demo server." }, 404);
    }

    return c.json(job);
  });
}
