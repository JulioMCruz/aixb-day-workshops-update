# Workshop 04 — Real x402 payments + browser wallet additions

This document is the participant guide for the `w04-update` branch.
It describes every change we made on top of Frutero's original
[`aixb-day-workshops`](https://github.com/fruteroclub/aixb-day-workshops)
repository, why we made it, and how to run the workshop from end to end.

> **TL;DR** — Frutero's workshop is great, but the stage 4 demo only shows a
> fixture payment (`x402-fixture-paid` magic string, no real USDC) and has no
> browser wallet button. Our `w04-update` branch adds:
>
> 1. A **cascade LLM reasoning** that tries Nebius → Groq → fixture, so the
>    demo never fails because a key is missing.
> 2. A **server-side live payment endpoint** (`POST /x402/pay`) that signs an
>    EIP-3009 `TransferWithAuthorization` with the workshop's buyer key and
>    settles a real testnet USDC job in Base Sepolia — no browser needed.
> 3. A **browser wallet button "Connect wallet" / "Pay with x402"** that lets
>    every participant connect their own EIP-1193 wallet (MetaMask, Coinbase
>    Wallet, Rabby, Frame) and pay for the job with their own USDC.
> 4. An **activity log panel** in the web UI so the audience can follow every
>    step of the payment (probe 402 → decoded PAYMENT-REQUIRED → signature →
>    settle → BaseScan URL → ERC-8004 feedback).

## Step 0 — Switch to the `w04-update` branch

The `main` branch of this repo is a clean fork of Frutero's repo. All the
code changes live in the `w04-update` branch.

```bash
# First time: clone and switch
git clone https://github.com/JulioMCruz/aixb-day-workshops-update.git
cd aixb-day-workshops-update
git fetch origin
git checkout -b w04-update origin/w04-update
git pull

# If you already cloned the repo:
git checkout w04-update
git pull
```

From this point on, every command assumes you are on `w04-update`.

## Step 1 — Install dependencies

```bash
cd server
npm install
```

The package list is the same as Frutero's plus a build-time esbuild call
(esbuild is a transitive dependency of `tsx`, so no new package is added
to `package.json` — only a new `build:web` script).

## Step 2 — Build the browser wallet bundle

The browser wallet button needs `public/x402-client.js`, a 412 KB ES module
that bundles viem 2.55, `@x402/evm` 2.17 and `@x402/fetch` 2.17. The
TypeScript source is in `src/web/x402-client.ts`.

```bash
npm run build:web
# → public/x402-client.js  412.6kb
# ⚡ Done in ~150ms
```

If you change `src/web/x402-client.ts`, re-run `npm run build:web` to
regenerate the bundle. The server serves it at `GET /x402-client.js`.

## Step 3 — Configure environment

Copy `.env.example` to `.env` and fill in the keys you have. The minimum
required keys to run the workshop are highlighted.

```bash
cp .env.example .env
$EDITOR .env
```

What is new in `.env.example` compared to Frutero's:

- A documented `GROQ_API_KEY` / `GROQ_MODEL` pair (Plan B LLM).
- A documented `X402_BUYER_PRIVATE_KEY` (used by `POST /x402/pay`).
- A documented `X402_PAY_TO` (the wallet that receives USDC). For a
  self-test you can set both to the same address.

If you only have Nebius, the cascade still works. If you have neither
Nebius nor Groq, the cascade falls back to a deterministic fixture
response and the demo still runs.

## Step 4 — Run the workshop (fixture mode)

```bash
npm run workshop:4
```

Open `http://localhost:3001`. The website should look like the end of W3
(the Mentor Agent panel at the top), with a new **Gate de pagos** panel
at the bottom that contains the four buttons:

- `Probar sin firma`
- `Probar con firma x402`
- `Connect wallet` (initially visible)
- `Pagar con x402` (hidden until the wallet is connected)

Click `Probar sin firma` with the **Activar pagos x402** switch OFF, and
you should see an HTTP 201 with a hardcoded demo string. That is the
default fixture behaviour.

Click `Probar sin firma` with the switch ON, and the server should reject
the request with HTTP 402 and a `PAYMENT-REQUIRED` header.

## Step 5 — Run the workshop (live mode on Base Sepolia)

Optional, but recommended. Live mode shows the audience a real testnet
settlement.

### 5.1 — Create a buyer wallet (or reuse an existing one)

```bash
npm run wallet:create
# → writes .aixb-wallet.fixture.json with { privateKey, address }
```

The script uses viem's `privateKeyToAccount`, which derives the EVM
address from `keccak256(publicKey)` — the same algorithm every EVM
wallet uses. (Frutero's original script used `sha256(privateKey).slice(-40)`
which produces a wrong address. We fixed that.)

Grab the private key from the file:

```bash
node -e 'const w=require("./.aixb-wallet.fixture.json");console.log(w.privateKey)'
```

Paste it into `.env` as `X402_BUYER_PRIVATE_KEY`.

### 5.2 — Fund the wallet with ETH (gas) and USDC (payment)

Two free faucets:

- ETH: <https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet>
  or <https://www.alchemy.com/faucets/base-sepolia>
- USDC: <https://faucet.circle.com/> (select Base Sepolia)

The Circle faucet also supports direct wallet connection, so you can
fund the wallet you just created with two clicks.

### 5.3 — Switch to live mode and restart the server

In `.env`, set:

```
X402_MODE=base-sepolia
X402_PAY_TO=0xYOUR_SELLER_WALLET
X402_BUYER_PRIVATE_KEY=0xYOUR_BUYER_PRIVATE_KEY
```

Restart:

```bash
npm run workshop:4
```

Open `http://localhost:3001`. The **live-hint** paragraph should appear
under the toggle, and the activity log should report
`Server mode: base-sepolia-live`.

## Step 6 — Pay with the server-side flow (no browser wallet needed)

The `POST /x402/pay` endpoint runs the full flow automatically:

1. Probe `POST /jobs` without signature, expect 402.
2. Decode the `PAYMENT-REQUIRED` header.
3. Sign an EIP-3009 `TransferWithAuthorization` with `X402_BUYER_PRIVATE_KEY`.
4. Retry `POST /jobs` with the `PAYMENT-SIGNATURE` header.
5. Print the onchain transaction hash and BaseScan URL.

The simplest way to trigger it is from the web UI: flip the switch ON,
then click the **Pagar con x402** button (the third button, hidden until
the browser wallet is connected — for the server-side flow, you can also
call the endpoint with `curl`).

Or from the command line:

```bash
npm run x402:pay
```

The script uses the official `@x402/fetch` client and prints the
resulting `paymentHeader.transaction` (the onchain tx hash). Verify it
on the Base Sepolia explorer:
<https://sepolia.basescan.org/tx/0xYOUR_TX_HASH>.

## Step 7 — Pay with your own browser wallet

This is the new bit on top of Frutero. Each participant connects their
own wallet and pays with their own USDC.

1. Make sure `X402_MODE=base-sepolia` in `.env` and the server is
   running.
2. Open `http://localhost:3001` in a browser that has MetaMask (or any
   EIP-1193 wallet) installed.
3. Click **Connect wallet** in the Gate de pagos panel. Accept the
   popup.
4. If you are not on Base Sepolia (chain id `0x14a34` = 84532), the
   **Switch to Base Sepolia** button appears. Click it to add the chain
   to your wallet and switch.
5. Click **Pay with x402**. Your wallet will pop up asking to sign an
   EIP-3009 `TransferWithAuthorization` for the job price.
6. The activity log shows the onchain transaction hash and a clickable
   BaseScan URL.

Each participant signs with their own key, so the workshop can run with
50 students without sharing a private key. Each student needs:

- A browser with MetaMask (or any EIP-1193 wallet) installed
- A small amount of Base Sepolia ETH for gas
- A small amount of Base Sepolia USDC for the job price

The facilitator wallet (`X402_PAY_TO`) receives USDC for every paid job.

## Summary of code changes

All the changes below live in the `w04-update` branch, in the `server/`
directory. See `git diff main..w04-update -- server` for the full diff.

### New files

- `server/public/x402-client.js` — esbuild bundle of the browser wallet
  client (viem + x402/evm + x402/fetch). Served at `GET /x402-client.js`.
- `server/src/web/x402-client.ts` — TypeScript source of the browser
  wallet client. Exports `window.aixbWallet` with 9 methods
  (`isConnected`, `getAddress`, `getChainId`, `connectWallet`,
  `disconnectWallet`, `switchToBaseSepolia`, `payWithX402`,
  `onAccountChanged`, `onChainChanged`).
- `server/src/routes/x402-pay.ts` — server-side live payment endpoint
  that runs the full probe → sign → settle flow and returns a 17-entry
  activity log plus the onchain transaction hash.

### Modified files

- `server/src/integrations/nebius.ts` — replaced `callNebius()` with
  `callLLM()` cascade that tries Nebius → Groq → fixture in order.
- `server/scripts/create-wallet.ts` — fixed the EVM address derivation
  bug (`sha256(privateKey).slice(-40)` → `keccak256(publicKey)` via
  viem's `privateKeyToAccount`).
- `server/src/app.ts` — added `GET /x402-client.js` route.
- `server/src/routes/web.ts` — added four wallet buttons (Connect wallet,
  Pay with x402, Switch to Base Sepolia, Disconnect), the activity log
  panel with color-coded entries, and the wallet-info paragraph.
- `server/src/types.ts` — added the `paymentsEnabled` / `mode` typing
  for the payment-mode endpoint.
- `server/.env.example` — documented `GROQ_API_KEY` / `GROQ_MODEL`
  (Plan B) and `X402_BUYER_PRIVATE_KEY` / `X402_PAY_TO`.
- `server/.gitignore` — added `.aixb-wallet.fixture.json` and
  `.env.backup-*` patterns.
- `server/package.json` — added `npm run build:web` script.
- `server/README.md` — added a section pointing to this `PASOS.md` and
  summarising the live settlement flow.

### What we deliberately did NOT change

- `server/src/integrations/x402.ts` — the @x402/hono middleware and
  verifier work as-is. The browser-signed `PAYMENT-SIGNATURE` is
  accepted by the same middleware, with no changes needed.
- `server/src/integrations/erc8004.ts` — the ERC-8004 identity card and
  the `erc8004Feedback` in paid job responses are unchanged.
- `server/src/integrations/github.ts`, `brain.ts`, `agent.ts`,
  `mentor.ts`, `mentor-agent.ts` — untouched.
- The whole `workshops/` directory except for this `PASOS.md` file.
- The whole `README.md` at the root of the repo.

## Why this approach

We chose to keep the server-side flow (`POST /x402/pay`) AND the
browser-side flow (`Connect wallet` / `Pay with x402`) because they
serve different audiences:

- The **server-side flow** is what the facilitator uses during the demo
  to show the audience a real settlement. It works even if the
  facilitator's browser has no wallet. The 17-entry activity log is the
  narrative for the audience.
- The **browser-side flow** is what each student runs on their own
  laptop. It teaches them that the buyer signs the payment with their
  own key — no one else's private key ever touches their machine. It
  also scales to 50 students with no per-student configuration.

Frutero's original `POST /jobs` accepts a `PAYMENT-SIGNATURE` header
with the magic string `x402-fixture-paid` for the no-fund demo. The
real settlement mode is the same middleware, but with a real signed
header. Our additions are entirely additive — they do not change any
of Frutero's existing endpoints, only add new ones (the `POST /x402/pay`
and the `GET /x402-client.js` routes, plus the four buttons in the
web UI).

## Cleanup after the workshop

- Delete `.aixb-wallet.fixture.json` (it still has whatever ETH and USDC
  you sent to the test wallet).
- Remove `X402_BUYER_PRIVATE_KEY` from `server/.env` if the file is
  shared.
- Switch `X402_MODE=fixture` (or unset it) to fall back to the no-fund
  demo.
- Optionally send the remaining testnet funds to a burn address.

## References

- Official Frutero workshop: <https://github.com/fruteroclub/aixb-day-workshops>
- x402 seller quickstart: <https://docs.x402.org/getting-started/quickstart-for-sellers>
- x402 MCP/agent flow: <https://docs.x402.org/guides/mcp-server-with-x402>
- ERC-8004: <https://eips.ethereum.org/EIPS/eip-8004>
- Circle USDC Faucet: <https://faucet.circle.com/>
- Coinbase Base Sepolia Faucet: <https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet>
- Alchemy Base Sepolia Faucet: <https://www.alchemy.com/factions/base-sepolia>
- Base Sepolia Explorer: <https://sepolia.basescan.org/>
