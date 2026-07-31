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
| **Fault reasons** | ⚠️ **generic** | On a chain-state fault the reason is the generic `simulation_failed`; it does **not** yet diagnose `insufficient_balance` vs `nonce_reuse`. |

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

Flags: `--port` (3402) · `--network` (eip155:84532) · `--asset` · `--token-name`/`--token-version` · `--fault transferReverts|settleReverts`.

### As a library

```ts
import { BenchFacilitator } from "x402-bench";

const bench = new BenchFacilitator({
  networks: "eip155:84532",
  chain: { deployedContracts: ["0x036cbd53842c5426634e7929541ec2318f3dcf7e"] }, // your asset
});

// `payload` is what a real @x402 client produces; `requirements` is the offer.
const { result, fidelity } = await bench.verify(payload, requirements);
console.log(result.isValid, fidelity.signature); // true "verified"  — or false on a bad signature

const settled = await bench.settle(payload, requirements);
console.log(settled.result.transaction); // 0x… a synthetic tx hash; nothing was submitted
```

### Fault injection

Model the chain-state failures a real facilitator would hit, so you can test your error paths offline:

```ts
new BenchFacilitator({ networks: "eip155:84532", chain: {
  deployedContracts: ["0x036cbd…"],
  faults: { transferReverts: true },  // the transfer would revert -> verify rejects
  // faults: { settleReverts: true }, // mined-but-reverted receipt -> settle fails
}});
```

## Status

`0.0.1` — the honest core: exact/EIP-3009 EVM verify + settle over a faked chain, with fidelity labeling on every result — as a **library** and as a runnable **`npx x402-bench` HTTP facilitator server** (fidelity header on every response). Not yet built:

- precise fault-reason diagnosis (`insufficient_balance` vs `nonce_reuse`, needs on-chain-diagnostic modeling);
- a live inspector (render each handshake as it happens);
- an offline load/throughput harness — because the facilitator is free and instant, you can hammer *your* integration with thousands of simulated payments to test concurrency/error-handling. **Guardrail:** it would measure *your integration's off-chain behavior only*, labeled as such — never chain/settlement performance, which is faked.

Contributions and issues welcome.

## License

MIT © 2026 Kevin Brown
