// Pure CLI argument planning for `npx x402-bench` — NO side effects (no server, no I/O, no exit), so
// it is unit-testable in-process. The bin (cli.ts) turns a plan into action. Splitting this out is
// what lets a test prove `--help` routes to `{action:"help"}` and NEVER to serve — i.e. `--help` can
// never start the server and hang, by construction, not by spawning the bin and hoping.
import type { MockFacilitatorFaults } from "./mock-facilitator-signer.js";

export const USAGE = `x402-bench — a local, honest x402 mock facilitator (real crypto, faked chain).

Usage: npx x402-bench [options]

Starts an HTTP facilitator speaking the @x402 wire (POST /verify, POST /settle,
GET /supported). Point your @x402 client's facilitator URL at it — no chain, no
faucet, no funds. A bad signature is REJECTED for real; chain state is simulated.

Options:
  --port <n>            Port to listen on (default 3402)
  --network <id>        CAIP-2 network id (default eip155:84532, Base Sepolia)
  --asset <0x…>         Token contract treated as deployed (default USDC on Base Sepolia)
  --token-name <s>      ERC-20 name for the EIP-712 domain (default USDC)
  --token-version <s>   ERC-20 version for the EIP-712 domain (default 2)
  --fault <kind>        Inject a chain-state fault:
                          insufficient_balance | nonce_used | transferReverts | settleReverts
  --quiet               Silence the live inspector (do not print handshakes)
  -h, --help            Show this help and exit

Every response carries an x-bench-fidelity header stating what was real vs. simulated.
Docs: https://github.com/x402spendguard/x402-bench`;

export interface ServePlan {
  action: "serve";
  port: number;
  network: string;
  asset: string;
  tokenName: string;
  tokenVersion: string;
  faults: MockFacilitatorFaults | undefined;
  /** The raw `--fault` value, kept only for the startup line. */
  faultLabel: string | undefined;
  quiet: boolean;
}
export type CliPlan = { action: "help" } | ServePlan;

/** Decide what `npx x402-bench <argv>` should DO — pure. `--help`/`-h` short-circuits to help, so the
 *  bin prints usage and exits without ever reaching server startup (the reported hang, closed by
 *  construction). `argv` is the full `process.argv` (or any slice); flags are matched by name. */
export function planFromArgv(argv: readonly string[]): CliPlan {
  if (argv.includes("--help") || argv.includes("-h")) return { action: "help" };
  const flag = (name: string, fallback?: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
  };
  const faultLabel = flag("fault"); // transferReverts | insufficient_balance | nonce_used | settleReverts
  const faults: MockFacilitatorFaults | undefined =
    faultLabel === "insufficient_balance"
      ? { transferReverts: "insufficient_balance" }
      : faultLabel === "nonce_used"
        ? { transferReverts: "nonce_used" }
        : faultLabel === "transferReverts"
          ? { transferReverts: true }
          : faultLabel === "settleReverts"
            ? { settleReverts: true }
            : undefined;
  return {
    action: "serve",
    port: Number(flag("port", "3402")),
    network: flag("network", "eip155:84532") as string,
    asset: flag("asset", "0x036cbd53842c5426634e7929541ec2318f3dcf7e") as string,
    tokenName: flag("token-name", "USDC") as string,
    tokenVersion: flag("token-version", "2") as string,
    faults,
    faultLabel,
    quiet: argv.includes("--quiet"),
  };
}
