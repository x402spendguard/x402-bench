// The honest mock facilitator. It is a thin, HONEST wrapper over the REAL @x402 facilitator:
// `x402Facilitator` + `ExactEvmScheme`, backed by a chain-faking signer. The real library does the
// crypto (ECDSA recovery, authorization + time-window checks); the signer only fakes chain state.
//
// Every result is LABELED. `verify`/`settle` return the real @x402 response PLUS a FidelityReport
// stating what was real vs. simulated — because the people who use this tool cannot read the SDK
// source to confirm the crypto is real, so the honesty has to travel in the output itself.
import { x402Facilitator } from "@x402/core/facilitator";
import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import type { PaymentPayload, PaymentRequirements, VerifyResponse, SettleResponse, Network } from "@x402/core/types";
import { makeMockFacilitatorSigner, type MockFacilitatorOpts } from "./mock-facilitator-signer.js";
import { EXACT_EVM_FIDELITY, FIDELITY_BANNER, type FidelityReport } from "./fidelity.js";

export interface BenchVerifyResult {
  /** The real @x402 verification response — isValid + invalidReason exactly as production returns. */
  result: VerifyResponse;
  /** What x402-bench actually did (signature: real; chain: simulated). */
  fidelity: FidelityReport;
}

export interface BenchSettleResult {
  /** The real @x402 settlement response — success + a SYNTHETIC transaction hash (nothing moved). */
  result: SettleResponse;
  fidelity: FidelityReport;
}

export interface BenchFacilitatorOpts {
  /** Network(s) to register the exact scheme for, e.g. "eip155:84532". */
  networks: Network | Network[];
  /** Chain-faking configuration: which contracts are "deployed", balance, and fault injection. */
  chain: MockFacilitatorOpts;
}

/**
 * A local, offline x402 facilitator that verifies signatures FOR REAL and fakes the chain. Drop the
 * payloads a real @x402 client produces into `verify`/`settle`; a tampered signature is rejected by
 * the real library, and settlement returns a synthetic tx hash. Fault injection lives in
 * `opts.chain.faults` (transferReverts, settleReverts).
 */
export class BenchFacilitator {
  /** The fidelity boundary, also available statically for callers that want to display it. */
  static readonly FIDELITY: FidelityReport = EXACT_EVM_FIDELITY;
  /** The loud, human-readable startup notice (print it in a CLI/server so the boundary is stated). */
  static readonly BANNER: string = FIDELITY_BANNER;

  private readonly facilitator: x402Facilitator;

  constructor(opts: BenchFacilitatorOpts) {
    const signer = makeMockFacilitatorSigner(opts.chain);
    this.facilitator = new x402Facilitator();
    registerExactEvmScheme(this.facilitator, { signer, networks: opts.networks });
  }

  /** Verify a payment payload. Real signature + authorization checks; simulated chain state. */
  async verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<BenchVerifyResult> {
    const result = await this.facilitator.verify(payload, requirements);
    return { result, fidelity: EXACT_EVM_FIDELITY };
  }

  /** Settle a payment. Re-verifies for real, then returns a SYNTHETIC tx hash (nothing is submitted). */
  async settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<BenchSettleResult> {
    const result = await this.facilitator.settle(payload, requirements);
    return { result, fidelity: EXACT_EVM_FIDELITY };
  }

  /** The facilitator's supported payment kinds / extensions / signers (served at GET /supported). */
  getSupported(): ReturnType<x402Facilitator["getSupported"]> {
    return this.facilitator.getSupported();
  }
}
