export type WorkshopStage = 1 | 2 | 3 | 4;

export type IntegrationState = "live" | "fixture" | "mock" | "configured" | "missing" | "not-enabled";

export type AppConfig = {
  stage: WorkshopStage;
  port: number;
  nebiusBaseUrl: string;
  walletFile: string;
  env: NodeJS.ProcessEnv;
};

export type StageCapability = {
  workshop: WorkshopStage;
  name: string;
  enabled: boolean;
  routes: string[];
};

export type NebiusResult = {
  integration: "live" | "fixture";
  provider: "nebius-token-factory" | "groq" | "local-fixture";
  model?: string;
  text: string;
  warnings?: string[];
};

export type RepoContext = {
  integration: "live" | "fixture";
  owner: string;
  repo: string;
  name: string;
  fullName: string;
  description: string | null;
  stars: number;
  forks: number;
  defaultBranch: string;
  language: string | null;
  topics: string[];
  languages: Record<string, number>;
  readmeExcerpt: string;
  warning?: string;
};

export type WalletStatus =
  | {
      integration: "fixture";
      address: string;
      network: string;
      warning: string;
    }
  | {
      integration: "missing";
      message: string;
    };

export type JobRecord = {
  id: string;
  status: "completed";
  integration: "payment-disabled" | "x402-fixture" | "x402-testnet";
  task: string;
  input: string;
  result: string;
  payment: {
    enabled: boolean;
    protocol: "none" | "x402";
    required: boolean;
  };
  receipt?: {
    protocol: "x402";
    type: "fixture" | "testnet";
    value: "x402-fixture-paid" | "testnet-valid";
    network: string;
    payTo: string;
    facilitator: string;
    verified: true;
  };
  erc8004Feedback?: {
    agentRegistry: string;
    agentId: number;
    tag1: string;
    tag2: string;
    endpoint: string;
    proofOfPayment: {
      fromAddress: string;
      toAddress: string;
      chainId: string;
      txHash: string;
      network: string;
      facilitator: string;
    };
  };
  createdAt: string;
};
