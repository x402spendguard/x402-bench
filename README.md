# x402-bench

**The x402 test bench — a local, honest mock facilitator.** Build and test an [x402](https://github.com/coinbase/x402) payer or resource server on your laptop, offline, with no testnet faucet, no funded wallet, and no live facilitator. Real signature verification, faked chain.

> **Honesty is the whole point.** x402-bench runs the **real `@x402` signature + authorization checks** — a broken signature is *rejected*, exactly as production would. It fakes only the chain (balance, nonce, settlement). And it **tells you which is which on every result**, so a green here never means more than it should.

## Why another mock?

Local x402 mocks already exist. The pure-mock ones take a shortcut that quietly hurts you: they *rubber-stamp*. Their `verify` checks that a signature **field is present**, not that the signature is **valid** — so a payload signed with a broken EIP-712 domain, a wrong nonce, or garbage bytes passes green locally and then fails on mainnet. The mock taught you a false green.

x402-bench can't do that, **by construction**. It does not implement `verify` at all. It injects a chain-faking signer into the *real* `@x402` `ExactEvmScheme`, and the real library recovers the EIP-712 signer itself (in-library ECDSA). The faked signer is never in the signature path — it *cannot* make a bad signature pass. The differentiator isn't "we promise to verify"; it's "we can't *not* verify."

## Fidelity — stated up front, not buried

| Aspect | x402-bench | Meaning |
| --- | --- | --- |
| **Signature + authorization** | ✅ **real** | Verified by `@x402` (real ECDSA recovery). A bad signature is rejected. |
| **Chain state** (balance, nonce, deployment) | ~ **simulated** | Faked, not read from any chain. |
| **Settlement** | ~ **synthetic** | Returns a well-formed but fabricated tx hash. Nothing is submitted; nothing moves. |
| **Fault reasons** | ✅ **precise (injected)** | Inject a specific cause and the facilitator's *own* diagnosis surfaces the precise reason (`insufficient_balance` / `nonce_used`); an unspecified revert yields generic `simulation_failed`. |

**A green result proves the payment is protocol-valid (its *shape* is right), NOT that a real chain would accept it.** For chain-acceptance you still need a testnet run. Every `verify`/`settle` result carries a `fidelity` field saying exactly this, and `BenchFacilitator.BANNER` is a ready-to-print notice for CLIs/servers.

## Quick start

### As a local facilitator server (`npx x402-bench`)

Start it, then point your real `@x402` client's facilitator URL at it — no chain, no faucet, no funds:

```bash
npx x402-bench --port 3402 --asset 0x036cbd53842c5426634e7929541ec2318f3dcf7e
#  POST /verify   POST /settle   GET /supported
#  every response carries an `x-bench-fidelity` header stating what was real vs. simulated
```

```ts
import { HTTPFacilitatorClient } from "@x402/core/http";

const facilitator = new HTTPFacilitatorClient({ url: "http://127.0.0.1:3402" });
// verify/settle exactly as against a production facilitator — a bad signature is rejected,
// settlement returns a synthetic tx hash. Nothing is submitted to any chain.
```

Flags: `--port` (3402) · `--network` (eip155:84532) · `--asset` · `--token-name`/`--token-version` · `--fault transferReverts|insufficient_balance|nonce_used|settleReverts` · `--quiet` (silence the live inspector).

### As a library

The one thing every library example needs is a **signed payment payload**. That's what a real `@x402`
client produces when it pays a 402 — so here is the whole loop, end to end, with a throwaway account
and no funds. (In your own app, steps 1–2 are just *your* client paying; you already have the payload.)

```ts
import { BenchFacilitator, startX402Server } from "x402-bench";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const CHAIN = "eip155:84532";
const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const requirement = {
  scheme: "exact", network: CHAIN, asset: USDC, amount: "10000",   // 0.01 USDC (6 decimals)
  payTo: "0x1111111111111111111111111111111111111111",
  maxTimeoutSeconds: 600, extra: { name: "USDC", version: "2" },   // `extra` is the EIP-712 domain
};

// 1. A real @x402 client with a throwaway signer (real key, no funds).
const account = privateKeyToAccount(generatePrivateKey());
const client = new x402Client();
registerExactEvmScheme(client, { signer: account as never });      // viem account -> SDK signer type
const http = new x402HTTPClient(client);

// 2. Get a genuine 402 (x402-bench's own resource server stands in) and sign it -> the payload.
const server = await startX402Server({ x402Version: 2, resource: { url: "http://resource.local/x" }, accepts: [requirement] });
const res = await fetch(server.url);
const header = res.headers.get("PAYMENT-REQUIRED");
const body = header ? undefined : await res.json();
const payload = await client.createPaymentPayload(http.getPaymentRequiredResponse((n) => res.headers.get(n), body));
await server.close();

// 3. Verify it — REAL signature check, faked chain. `fidelity` says which is which, on every result.
const bench = new BenchFacilitator({ networks: CHAIN, chain: { deployedContracts: [USDC], token: { name: "USDC", version: "2" } } });
const { result, fidelity } = await bench.verify(payload, requirement);
console.log(result.isValid, fidelity.signature); // true "verified" — a TAMPERED signature would be false

const settled = await bench.settle(payload, requirement);
console.log(settled.result.transaction);          // 0x… a synthetic tx hash; nothing was submitted
```

> This exact flow — including the tamper-is-rejected check — runs in [`test/documented-example.test.ts`](https://github.com/x402spendguard/x402-bench/blob/main/test/documented-example.test.ts), so the example can't quietly rot.

### Fault injection

Model the chain-state failures a real facilitator would hit, so you can test your error paths offline:

```ts
new BenchFacilitator({ networks: "eip155:84532", chain: {
  deployedContracts: ["0x036cbd…"],
  faults: { transferReverts: "insufficient_balance" }, // verify rejects with the PRECISE reason
  // faults: { transferReverts: "nonce_used" },        // precise: nonce_already_used
  // faults: { transferReverts: true },                // generic: simulation_failed
  // faults: { settleReverts: true },                  // mined-but-reverted receipt -> settle fails
}});
```

The precise reason isn't invented — you answer the facilitator's own diagnostic reads with the state you inject, and *it* diagnoses. So your error-handling is tested against the same reason string production would emit.

## Status

`0.1.0` — the honest core, complete: exact/EIP-3009 EVM verify + settle over a faked chain, with fidelity labeling on every result — as a **library**, a runnable **`npx x402-bench` HTTP facilitator server** (fidelity header on every response), and a **live inspector** (each handshake printed as it happens; `--quiet` to silence). Injected chain-state faults surface the facilitator's own **precise** reason (`insufficient_balance` / `nonce_used`). Not yet built:

- an offline load/throughput harness — because the facilitator is free and instant, you can hammer *your* integration with thousands of simulated payments to test concurrency/error-handling. **Guardrail:** it would measure *your integration's off-chain behavior only*, labeled as such — never chain/settlement performance, which is faked.

Contributions and issues welcome.

## License

MIT © 2026 Kevin Brown
