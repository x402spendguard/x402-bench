#!/usr/bin/env node
// `npx x402-bench` — start the local honest facilitator and point your @x402 client at it.
// Prints the fidelity banner LOUDLY first, so the boundary (real crypto, faked chain) is stated
// before a single request is served.
import type { Network } from "@x402/core/types";
import { startBenchServer, type BenchEvent } from "./server.js";
import { FIDELITY_BANNER } from "./fidelity.js";

function flag(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const port = Number(flag("port", "3402"));
const network = flag("network", "eip155:84532") as string;
const asset = flag("asset", "0x036cbd53842c5426634e7929541ec2318f3dcf7e") as string;
const tokenName = flag("token-name", "USDC") as string;
const tokenVersion = flag("token-version", "2") as string;
const fault = flag("fault"); // "transferReverts" | "settleReverts"
const faults =
  fault === "transferReverts" ? { transferReverts: true } : fault === "settleReverts" ? { settleReverts: true } : undefined;
const quiet = process.argv.includes("--quiet");

const short = (a?: string): string => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a ?? "?");

/** The live inspector: render each handshake legibly, carrying the real-vs-simulated marks. */
function printEvent(e: BenchEvent): void {
  if (e.route === "supported") {
    console.error("  · supported  kinds served");
    return;
  }
  const mark = e.verdict === "accepted" ? "✓ accepted" : `✗ rejected (${e.reason ?? "?"})`;
  const tx = e.transaction ? `  tx=${e.transaction.slice(0, 10)}…(synthetic)` : "";
  console.error(`  · ${e.route.padEnd(7)} ${short(e.payer)} → ${short(e.payTo)}  ${e.amount ?? ""}  ${mark}${tx}`);
  console.error(`              sig ✓ real · chain ~ simulated${e.route === "settle" ? " · settle ~ synthetic" : ""}`);
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.error(FIDELITY_BANNER);
  console.error("");
  const server = await startBenchServer({
    networks: network as Network,
    chain: { deployedContracts: [asset], token: { name: tokenName, version: tokenVersion }, faults },
    port,
    onEvent: quiet ? undefined : printEvent,
  });
  console.error(`x402-bench facilitator listening on ${server.url}`);
  console.error(`  POST ${server.url}/verify   POST ${server.url}/settle   GET ${server.url}/supported`);
  console.error(`  network=${network} asset=${asset}${fault ? ` fault=${fault}` : ""}`);
  console.error(`  point your @x402 client's facilitator URL here. Ctrl-C to stop.`);
  console.error(quiet ? "  (inspector off — remove --quiet to watch handshakes)" : "  live inspector on — handshakes print below:");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
