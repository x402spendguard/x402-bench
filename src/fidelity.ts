// THE HONESTY SURFACE. x402-bench's whole reason to exist is that it does NOT teach a false green.
// A rubber-stamp mock (e.g. xpaysh/x402-local, whose `validatePayment` is a field-presence check)
// passes a broken signature and lets a developer ship it to mainnet. x402-bench can't: it runs the
// REAL @x402 signature verification. But it fakes the chain — and the one way this tool could still
// mislead is by faking something it *appears* to check. So every result it emits carries a
// FidelityReport stating, in the output itself, what was real vs. simulated. For a user who cannot
// read the SDK source (the way it's verifiable that the crypto is real), the labeling IS the honesty.

/** What x402-bench actually did, attached to every verify/settle result. */
export interface FidelityReport {
  /** REAL. @x402 recovers the EIP-712 signer in-library (ECDSA); a bad signature is rejected. */
  signature: "verified";
  /** SIMULATED. Balance, nonce state, and contract deployment are faked, not read from a chain. */
  chain: "simulated";
  /** SYNTHETIC. Settlement returns a well-formed but fabricated tx hash; nothing is submitted. */
  settlement: "synthetic";
  /** Human-readable statement of the boundary, including the known reason-diagnosis limitation. */
  note: string;
}

/** The fidelity of the exact/EIP-3009 EVM path — the one x402-bench implements today. */
export const EXACT_EVM_FIDELITY: FidelityReport = {
  signature: "verified",
  chain: "simulated",
  settlement: "synthetic",
  note:
    "Signature + authorization are verified FOR REAL by @x402 (in-library ECDSA recovery) — a bad " +
    "signature is rejected. Chain state (balance, nonce, deployment) is SIMULATED. Settlement returns " +
    "a SYNTHETIC tx hash; nothing is submitted to any chain. On chain-state faults the rejection reason " +
    "is GENERIC (simulation_failed): x402-bench does not yet diagnose insufficient_balance vs nonce_reuse. " +
    "A green here proves SHAPE-acceptance (the payment is protocol-valid), NOT chain-acceptance.",
};

/** The loud startup notice — printed by the CLI/server so the boundary is stated to the user's face,
 *  never left implicit. Keep it in sync with EXACT_EVM_FIDELITY. */
export const FIDELITY_BANNER = `x402-bench — HONEST MOCK FACILITATOR (offline; nothing is submitted to a chain)
  [real]      signatures      verified for real (@x402 ECDSA) — a bad signature is REJECTED
  [simulated] chain state     balance / nonce / deployment are faked
  [synthetic] settlement      a fabricated tx hash; no chain, no gas, nothing moves
  [limit]     fault reasons   generic (simulation_failed); precise diagnosis not yet implemented
A green result proves the payment is protocol-valid (SHAPE), NOT that a real chain would accept it.`;
