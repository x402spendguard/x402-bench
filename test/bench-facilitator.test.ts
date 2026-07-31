// The offline proof for x402-bench itself: a REAL @x402 client produces a genuine signed payment
// against a genuine 402, and the BenchFacilitator verifies + settles it with no chain, no key, no
// funds. These are the same load-bearing assertions carried over from the spendguard seed, plus the
// one this tool adds: every result carries an honest fidelity label.
import { describe, it, expect } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { BenchFacilitator, startX402Server } from "../src/index.js";

const CHAIN = "eip155:84532";
const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const AMOUNT = "10000"; // atomic USDC (6 decimals) -> 0.01 USDC

// Produce a REAL signed exact/EIP-3009 payment for `AMOUNT` -> `payTo` via the real @x402 client and
// a throwaway account (real crypto, no funds). No guard, no spendguard — just the raw client.
async function makePayment(payTo: string): Promise<{ payload: PaymentPayload; requirement: PaymentRequirements }> {
  const account = privateKeyToAccount(generatePrivateKey());
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account as never });
  const httpClient = new x402HTTPClient(client);

  const requirement = { scheme: "exact", network: CHAIN, asset: USDC, amount: AMOUNT, payTo, maxTimeoutSeconds: 600, extra: { name: "USDC", version: "2" } };
  const pr = { x402Version: 2, resource: { url: "http://resource.local/x" }, accepts: [requirement] } as unknown as PaymentRequired;

  const server = await startX402Server(pr);
  try {
    const res = await fetch(server.url);
    const header = res.headers.get("PAYMENT-REQUIRED");
    const body = header ? undefined : await res.json();
    const paymentRequired = httpClient.getPaymentRequiredResponse((n) => res.headers.get(n), body);
    const payload = (await client.createPaymentPayload(paymentRequired)) as PaymentPayload;
    return { payload, requirement: requirement as unknown as PaymentRequirements };
  } finally {
    await server.close();
  }
}

const bench = (faults?: { transferReverts?: boolean; settleReverts?: boolean }) =>
  new BenchFacilitator({ networks: CHAIN, chain: { deployedContracts: [USDC], token: { name: "USDC", version: "2" }, faults } });

describe("BenchFacilitator (offline, real crypto, faked chain)", () => {
  it("HAPPY: verifies + settles a real payment, returns a synthetic tx hash, and labels its fidelity", async () => {
    const payTo = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
    const { payload, requirement } = await makePayment(payTo);

    const verify = await bench().verify(payload, requirement);
    expect(verify.result.isValid, `verify failed: ${verify.result.invalidReason ?? ""}`).toBe(true);
    // The honesty label rides on the result — signature real, chain/settlement faked.
    expect(verify.fidelity.signature).toBe("verified");
    expect(verify.fidelity.chain).toBe("simulated");

    const settle = await bench().settle(payload, requirement);
    expect(settle.result.success, `settle failed: ${settle.result.errorReason ?? ""}`).toBe(true);
    expect(settle.result.transaction).toMatch(/^0x[0-9a-f]{64}$/);
    expect(settle.fidelity.settlement).toBe("synthetic");
  });

  it("DIFFERENTIATOR: the SAME payload is accepted untampered but REJECTED after one flipped byte", async () => {
    const payTo = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
    const { payload, requirement } = await makePayment(payTo);

    // NON-VACUOUS: the untouched payload IS accepted — not rejecting everything.
    expect((await bench().verify(payload, requirement)).result.isValid).toBe(true);

    // One flipped signature nibble -> the real @x402 ECDSA recovery (which the mock cannot reach)
    // rejects it. This is the exact payload a rubber-stamp mock waves through green.
    const bad = structuredClone(payload) as PaymentPayload & { payload: { signature: string } };
    const sig = bad.payload.signature;
    bad.payload.signature = sig.slice(0, 12) + (sig[12] === "a" ? "b" : "a") + sig.slice(13);
    const verify = await bench().verify(bad, requirement);
    expect(verify.result.isValid).toBe(false);
    expect(String(verify.result.invalidReason ?? "")).toContain("signature");
  });

  it("FAULT transferReverts: injecting a reverting transfer flips a PASSING payment to REJECTED", async () => {
    const payTo = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
    const { payload, requirement } = await makePayment(payTo);

    expect((await bench().verify(payload, requirement)).result.isValid).toBe(true);
    const verify = await bench({ transferReverts: true }).verify(payload, requirement);
    expect(verify.result.isValid).toBe(false);
    expect(verify.result.invalidReason, "a rejection reason is surfaced").toBeTruthy();
  });

  it("FAULT settleReverts: flips a SETTLING payment to a loud, labeled settle failure", async () => {
    const payTo = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
    const { payload, requirement } = await makePayment(payTo);

    expect((await bench().settle(payload, requirement)).result.success).toBe(true);
    const settle = await bench({ settleReverts: true }).settle(payload, requirement);
    expect(settle.result.success).toBe(false);
    expect(String(settle.result.errorReason ?? "")).toContain("transaction_failed");
  });
});
