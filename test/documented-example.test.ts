// Proves the README's LIBRARY quick-start is RUNNABLE, not aspirational. The old README showed
// `bench.verify(payload, requirements)` but never showed how to PRODUCE `payload` — a stranger copying
// it got a ReferenceError. This test runs the full documented flow: stand up a local 402 (x402-bench's
// own resource server), produce a REAL signed payload with a throwaway account, verify it against
// BenchFacilitator (real signature, faked chain), and show the tamper rejection. Keep it in lockstep
// with the README "As a library" block — it is the drift guard for that example.
import { describe, it, expect } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { BenchFacilitator, startX402Server } from "../src/index.js";

const CHAIN = "eip155:84532";
const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const AMOUNT = "10000"; // 0.01 USDC (6 decimals)

/** Produce a genuine signed exact/EIP-3009 payment the way a production @x402 client does — the step
 *  the README now shows in full. A local resource server answers a real 402; the client signs it. */
async function signedPayment(): Promise<{ payload: PaymentPayload; requirements: PaymentRequirements }> {
  const account = privateKeyToAccount(generatePrivateKey()); // throwaway payer, no funds
  const payTo = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account as never });
  const http = new x402HTTPClient(client);
  const requirement = { scheme: "exact", network: CHAIN, asset: USDC, amount: AMOUNT, payTo, maxTimeoutSeconds: 600, extra: { name: "USDC", version: "2" } };
  const pr = { x402Version: 2, resource: { url: "http://resource.local/x" }, accepts: [requirement] } as unknown as PaymentRequired;

  const server = await startX402Server(pr);
  try {
    const res = await fetch(server.url);
    const header = res.headers.get("PAYMENT-REQUIRED");
    const body = header ? undefined : await res.json();
    const payload = (await client.createPaymentPayload(http.getPaymentRequiredResponse((n) => res.headers.get(n), body))) as PaymentPayload;
    return { payload, requirements: requirement as unknown as PaymentRequirements };
  } finally {
    await server.close();
  }
}

describe("README library quick-start is runnable (not aspirational)", () => {
  it("produces-a-real-payload-verifies-it-and-rejects-a-tamper", async () => {
    const { payload, requirements } = await signedPayment();
    const bench = new BenchFacilitator({
      networks: CHAIN,
      chain: { deployedContracts: [USDC], token: { name: "USDC", version: "2" } },
    });

    // Valid payment: real signature check passes; fidelity says signature real / chain simulated.
    const ok = await bench.verify(payload, requirements);
    expect(ok.result.isValid).toBe(true);
    expect(ok.fidelity.signature).toBe("verified");
    expect(ok.fidelity.chain).toBe("simulated");

    // Tamper one signature nibble -> the REAL @x402 recovery rejects it (a rubber-stamp mock wouldn't).
    const tampered = structuredClone(payload) as PaymentPayload & { payload: { signature: string } };
    const s = tampered.payload.signature;
    tampered.payload.signature = s.slice(0, 12) + (s[12] === "a" ? "b" : "a") + s.slice(13);
    const bad = await bench.verify(tampered, requirements);
    expect(bad.result.isValid).toBe(false);
  });
});
