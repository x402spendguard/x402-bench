// The HTTP proof: a REAL @x402 HTTPFacilitatorClient talks to the running x402-bench server over the
// wire and the whole flow works — verify + settle — with the honesty label on every response. This
// is the `npx x402-bench` experience under test: point a production client at localhost, no chain.
import { describe, it, expect } from "vitest";
import { HTTPFacilitatorClient } from "@x402/core/http";
import type { PaymentPayload } from "@x402/core/types";
import { startBenchServer, type BenchEvent } from "../src/index.js";
import { CHAIN, USDC, makePayment, randomAddress } from "./helpers.js";

const startServer = (faults?: { transferReverts?: boolean; settleReverts?: boolean }) =>
  startBenchServer({ networks: CHAIN, chain: { deployedContracts: [USDC], token: { name: "USDC", version: "2" }, faults }, port: 0 });

describe("bench HTTP facilitator server (a real HTTPFacilitatorClient over the wire)", () => {
  it("HAPPY: a real client verifies + settles over HTTP; the fidelity header rides every response", async () => {
    const { payload, requirement } = await makePayment(randomAddress());
    const server = await startServer();
    try {
      const facilitator = new HTTPFacilitatorClient({ url: server.url });
      const verify = await facilitator.verify(payload as never, requirement as never);
      expect(verify.isValid, `verify failed: ${verify.invalidReason ?? ""}`).toBe(true);

      const settle = await facilitator.settle(payload as never, requirement as never);
      expect(settle.success, `settle failed: ${settle.errorReason ?? ""}`).toBe(true);
      expect(settle.transaction).toMatch(/^0x[0-9a-f]{64}$/);

      // The honesty label is present on every HTTP response, in a header (so it never breaks the
      // client's response-schema validation) — the anti-becoming-a-silent-rubber-stamp guardrail.
      const raw = await fetch(`${server.url}/supported`);
      expect(raw.headers.get("x-bench-fidelity")).toContain("signature=verified");
      expect(raw.headers.get("x-bench-fidelity")).toContain("chain=simulated");
    } finally {
      await server.close();
    }
  });

  it("DIFFERENTIATOR over HTTP: a tampered signature is rejected (isValid false), accepted untampered", async () => {
    const { payload, requirement } = await makePayment(randomAddress());
    const server = await startServer();
    try {
      const facilitator = new HTTPFacilitatorClient({ url: server.url });
      expect((await facilitator.verify(payload as never, requirement as never)).isValid).toBe(true);

      const bad = structuredClone(payload) as PaymentPayload & { payload: { signature: string } };
      const sig = bad.payload.signature;
      bad.payload.signature = sig.slice(0, 12) + (sig[12] === "a" ? "b" : "a") + sig.slice(13);
      expect((await facilitator.verify(bad as never, requirement as never)).isValid).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("GET /supported returns the registered exact/eip155 kind", async () => {
    const server = await startServer();
    try {
      const facilitator = new HTTPFacilitatorClient({ url: server.url });
      const supported = await facilitator.getSupported();
      expect(supported.kinds.some((k) => k.scheme === "exact")).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("INSPECTOR: emits a legible event per handshake (verdict, payer, synthetic tx)", async () => {
    const { payload, requirement } = await makePayment(randomAddress());
    const events: BenchEvent[] = [];
    const server = await startBenchServer({
      networks: CHAIN,
      chain: { deployedContracts: [USDC], token: { name: "USDC", version: "2" } },
      port: 0,
      onEvent: (e) => events.push(e),
    });
    try {
      const facilitator = new HTTPFacilitatorClient({ url: server.url });
      await facilitator.verify(payload as never, requirement as never);
      await facilitator.settle(payload as never, requirement as never);

      const verify = events.find((e) => e.route === "verify");
      const settle = events.find((e) => e.route === "settle");
      expect(verify?.verdict).toBe("accepted");
      expect(verify?.payer, "the inspector surfaces the payer").toBeTruthy();
      expect(settle?.verdict).toBe("accepted");
      expect(settle?.transaction).toMatch(/^0x[0-9a-f]{64}$/);
    } finally {
      await server.close();
    }
  });

  it("ISOLATION: a THROWING onEvent (a user's buggy tap) never breaks the handshake", async () => {
    const { payload, requirement } = await makePayment(randomAddress());
    const server = await startBenchServer({
      networks: CHAIN,
      chain: { deployedContracts: [USDC], token: { name: "USDC", version: "2" } },
      port: 0,
      onEvent: () => {
        throw new Error("buggy observer");
      },
    });
    try {
      // Every route invokes onEvent; a throwing tap must NOT turn any handshake into a 500. The
      // facilitator's liveness is isolated from the observer by construction (containment-wrapped emit).
      const facilitator = new HTTPFacilitatorClient({ url: server.url });
      expect((await facilitator.verify(payload as never, requirement as never)).isValid).toBe(true);
      expect((await facilitator.settle(payload as never, requirement as never)).success).toBe(true);
      expect((await facilitator.getSupported()).kinds.length).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  });
});
