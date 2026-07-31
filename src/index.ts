// x402-bench — a local, honest mock facilitator for the x402 payment protocol.
// Real @x402 signature verification, faked chain. It won't teach you a false green.
export {
  BenchFacilitator,
  type BenchFacilitatorOpts,
  type BenchVerifyResult,
  type BenchSettleResult,
} from "./bench-facilitator.js";
export {
  makeMockFacilitatorSigner,
  type MockFacilitatorOpts,
  type MockFacilitatorFaults,
} from "./mock-facilitator-signer.js";
export { startX402Server, type LocalServer } from "./mock-resource-server.js";
export { startBenchServer, type BenchServerOpts, type RunningBenchServer } from "./server.js";
export { EXACT_EVM_FIDELITY, FIDELITY_BANNER, type FidelityReport } from "./fidelity.js";
