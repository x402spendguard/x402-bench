#!/usr/bin/env node
// `npx x402-bench` — start the local honest facilitator and point your @x402 client at it.
// Prints the fidelity banner LOUDLY first, so the boundary (real crypto, faked chain) is stated
// before a single request is served.
import type { Network } from "@x402/core/types";
import { startBenchServer, type BenchEvent } from "./server.js";
import { FIDELITY_BANNER } from "./fidelity.js";
import { planFromArgv, USAGE } from "./cli-plan.js";

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
  const plan = planFromArgv(process.argv);
  if (plan.action === "help") {
    // Usage on stdout, then a normal return -> exit 0. Never reaches startBenchServer, so `--help`
    // can never boot the facilitator and hang (the reported bug, closed by construction).
    // eslint-disable-next-line no-console
    console.log(USAGE);
    return;
  }
  // eslint-disable-next-line no-console
  console.error(FIDELITY_BANNER);
  console.error("");
  const server = await startBenchServer({
    networks: plan.network as Network,
    chain: { deployedContracts: [plan.asset], token: { name: plan.tokenName, version: plan.tokenVersion }, faults: plan.faults },
    port: plan.port,
    onEvent: plan.quiet ? undefined : printEvent,
  });
  console.error(`x402-bench facilitator listening on ${server.url}`);
  console.error(`  POST ${server.url}/verify   POST ${server.url}/settle   GET ${server.url}/supported`);
  console.error(`  network=${plan.network} asset=${plan.asset}${plan.faultLabel ? ` fault=${plan.faultLabel}` : ""}`);
  console.error(`  point your @x402 client's facilitator URL here. Ctrl-C to stop.`);
  console.error(plan.quiet ? "  (inspector off — remove --quiet to watch handshakes)" : "  live inspector on — handshakes print below:");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
