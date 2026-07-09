import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";

const privateKey = `0x${randomBytes(32).toString("hex")}`;
const account = privateKeyToAccount(privateKey as `0x${string}`);

const wallet = {
  mode: "fixture",
  network: "no-mainnet",
  address: account.address,
  privateKey,
  warning: "Demo identity only. Do not fund this wallet with real assets.",
  createdAt: new Date().toISOString()
};

writeFileSync(".aixb-wallet.fixture.json", JSON.stringify(wallet, null, 2));

console.log(`Created fixture wallet identity: ${account.address}`);
console.log("Stored in .aixb-wallet.fixture.json. Do not commit this file.");
