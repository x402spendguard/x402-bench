// The offline proof for x402-bench's library API: a REAL @x402 client produces a genuine signed
// payment, and BenchFacilitator verifies + settles it with no chain, no key, no funds. Same
// load-bearing assertions as the spendguard seed, plus the one this tool adds: every result carries
// an honest fidelity label.
import { describe, it, expect } from "vitest";
import type { PaymentPayload } from "@x402/core/types";
import { BenchFacilitator } from "../src/index.js";
import { CHAIN, USDC, makePayment, randomAddress } from "./helpers.js";

const bench = (faults?: { transferReverts?: boolean | "insufficient_balance" | "nonce_used"; settleReverts?: boolean }) =>
  new BenchFacilitator({ networks: CHAIN, chain: { deployedContracts: [USDC], token: { name: "USDC", version: "2" }, faults } });

describe("BenchFacilitator (offline, real crypto, faked chain)", () => {
  it("HAPPY: verifies + settles a real payment, returns a synthetic tx hash, and labels its fidelity", async () => {
    const { payload, requirement } = await makePayment(randomAddress());

    const verify = await bench().verify(payload, requirement);
    expect(verify.result.isValid, `verify failed: ${verify.result.invalidReason ?? ""}`).toBe(true);
    expect(verify.fidelity.signature).toBe("verified");
    expect(verify.fidelity.chain).toBe("simulated");

    const settle = await bench().settle(payload, requirement);
    expect(settle.result.success, `settle failed: ${settle.result.errorReason ?? ""}`).toBe(true);
    expect(settle.result.transaction).toMatch(/^0x[0-9a-f]{64}$/);
    expect(settle.fidelity.settlement).toBe("synthetic");
  });

  it("DIFFERENTIATOR: the SAME payload is accepted untampered but REJECTED after one flipped byte", async () => {
    const { payload, requirement } = await makePayment(randomAddress());

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
    const { payload, requirement } = await makePayment(randomAddress());

    expect((await bench().verify(payload, requirement)).result.isValid).toBe(true);
    const verify = await bench({ transferReverts: true }).verify(payload, requirement);
    expect(verify.result.isValid).toBe(false);
    expect(verify.result.invalidReason, "a rejection reason is surfaced").toBeTruthy();
  });

  it("FAULT settleReverts: flips a SETTLING payment to a loud, labeled settle failure", async () => {
    const { payload, requirement } = await makePayment(randomAddress());

    expect((await bench().settle(payload, requirement)).result.success).toBe(true);
    const settle = await bench({ settleReverts: true }).settle(payload, requirement);
    expect(settle.result.success).toBe(false);
    expect(String(settle.result.errorReason ?? "")).toContain("transaction_failed");
  });

  it("FAULT insufficient_balance: the facilitator's OWN diagnosis surfaces the PRECISE reason", async () => {
    const { payload, requirement } = await makePayment(randomAddress());
    // We answer the facilitator's MULTICALL3 diagnostic reads (balance=0) so ITS diagnosis lands on
    // insufficient_balance — not a reason we invented, a reason it derived from the state we simulate.
    const verify = await bench({ transferReverts: "insufficient_balance" }).verify(payload, requirement);
    expect(verify.result.isValid).toBe(false);
    expect(String(verify.result.invalidReason ?? "")).toContain("insufficient_balance");
  });

  it("FAULT nonce_used: an injected used nonce surfaces the PRECISE reason (not generic)", async () => {
    const { payload, requirement } = await makePayment(randomAddress());
    const verify = await bench({ transferReverts: "nonce_used" }).verify(payload, requirement);
    expect(verify.result.isValid).toBe(false);
    expect(String(verify.result.invalidReason ?? "")).toContain("nonce_already_used");
  });

  it("FAULT transferReverts:true stays GENERIC (unspecified cause → simulation_failed)", async () => {
    const { payload, requirement } = await makePayment(randomAddress());
    const verify = await bench({ transferReverts: true }).verify(payload, requirement);
    expect(verify.result.isValid).toBe(false);
    expect(String(verify.result.invalidReason ?? "")).toContain("simulation");
  });
});
