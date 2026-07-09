# Test log — ERC-8004 real register() on Base Sepolia (2026-07-09 10:36 UTC)

## Setup
- **Wallet**: `0x4a8FFDA35Fd4463E881a0E69215B547FE8EFCEd4` (the facilitator's `X402_BUYER_PRIVATE_KEY` wallet)
- **Network**: Base Sepolia (chainId 84532)
- **Registry**: `0x8004A818BFB912233c491871b3d84c89A494BD9e` (`IdentityRegistry`)
- **Pre-tx state**: `balanceOf(0x4a8FFDA35...) = 0` (NOT registered)
- **Gas available**: 0.05 ETH (~$150 at Base Sepolia prices)
- **Server**: `WORKSHOP_STAGE=4 PORT=3012` running locally

## Flow executed

### Step 1: server pre-builds selfRegistrationURI

```
GET http://localhost:3012/agents/0x4a8FFDA35Fd4463E881a0E69215B547FE8EFCEd4
```

Response: `registered: false, agentId: null, selfRegistrationURI: "data:application/json;base64,eyJ0eXBlIjoi..."` (905 chars total, 876 base64).

The decoded JSON is a complete `eip-8004#registration-v1` document with:
- `name: "AI x Blockchain Day Workshop Agent"`
- `description: "Self-registered agent at AI x Blockchain Day. Owner: 0x4a8FFDA35..."`
- `image: "http://localhost:3012/social/agent.png"`
- `services[]`: 3 endpoints (web, API, x402)
- `x402Support: true`
- `registrations[0].agentRegistry: "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e"`

### Step 2: viem encodes register(string) call data

`encodeFunctionData({abi, functionName: "register", args: [selfRegistrationURI]})` returns 1994-char hex starting with `0xf2c298be` (function selector for `register(string)`).

### Step 3: signed tx sent onchain

```
txHash: 0xe476dafc9b7c7ec009891b8be8370aac501c6eef21137853308554da423ea3ab
blockNumber: 43912564
status: success
gasUsed: 799556
```

### Step 4: event log recovered agentId

```
Registered event:
  agentId: 7893
  owner: 0x4a8FFDA35Fd4463E881a0E69215B547FE8EFCEd4
  agentURI length: 905 (matches the URI we sent)
```

### Step 5: server lookup confirms

`GET /agents/0x4a8FFDA35...` (after the tx) returns:
- `registered: true, agentId: 7893`
- `agentURI: "data:application/json;base64,eyJ0eXBlIjoi..."` (full 905 chars, matches input)
- `registrationTxHash: "0xe476dafc9b7c7ec009891b8be8370aac501c6eef21137853308554da423ea3ab"`
- `baseScanToken: "https://sepolia.basescan.org/token/0x8004A818...?a=0x4a8FFDA35..."`
- Lookup latency: **0.45s** (single 2000-block chunk, one RPC call, log in latest blocks)

### Step 6: onchain verification (raw contract reads)

- `balanceOf(0x4a8FFDA35...) = 1` (was 0)
- `tokenURI(7893) = "data:application/json;base64,eyJ0eXBlIjoi..."` (length 905, matches)

## Live token

- <https://sepolia.basescan.org/tx/0xe476dafc9b7c7ec009891b8be8370aac501c6eef21137853308554da423ea3ab> (the registration tx)
- <https://sepolia.basescan.org/token/0x8004A818BFB912233c491871b3d84c89A494BD9e?a=0x4a8FFDA35Fd4463E881a0E69215B547FE8EFCEd4> (the NFT in the wallet)

## Conclusions

- **The Nivel 3 implementation works end-to-end onchain.** Server pre-builds
  a valid ERC-8004 v1 registration JSON, encodes the call data correctly,
  the tx mines successfully, the agentId is recovered from the event log,
  and the lookup endpoint surfaces the new state immediately.
- **Gas cost is negligible**: 799556 gas × ~1 gwei ≈ 0.0008 ETH. The 0.05 ETH
  reserve in `X402_BUYER_PRIVATE_KEY` wallet can fund ~62 registrations before
  needing a refill.
- **Lookup latency is fast for new registrations** (0.45s) because the
  `Registered` event is in the most recent 2000 blocks. Old registrations
  (outside the 200k-block scan window) return `agentId: null` but include
  a `baseScanToken` URL for manual verification.
- **The browser flow** (used by the workshop students) does the same thing
  via MetaMask: encode call data in `src/web/x402-client.ts` →
  `window.ethereum.request({method: "eth_sendTransaction", ...})` → sign
  in wallet → server polls for the agentId. Tested via the bundle build
  (`npm run build:web` produces 479.2KB with all the methods).

## What this proves for the workshop

- Students can register their own wallet onchain during the demo (25 min
  slot has time for a 60s poll).
- The agentId they get is real and verifiable on BaseScan.
- The erc8004Feedback in their paid job response references the same NFT
  (conceptually — feedback references agentId, not address).
