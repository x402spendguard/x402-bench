// The chain-faking half of x402-bench — a MOCK FacilitatorEvmSigner.
//
// THE HONESTY INVARIANT (why x402-bench is not a rubber-stamp): we do NOT write a facilitator. This
// signer is injected into the REAL @x402/evm `ExactEvmScheme` (via the real `x402Facilitator`), so
// every DETERMINISTIC security check runs in the production library, unmodified:
//   - EIP-712 digest hashing + ECDSA signer recovery  (recoverAddress, in-library)
//   - recipient / value / network / scheme match
//   - validAfter / validBefore time-window checks
// A mock signer STRUCTURALLY CANNOT make a bad signature pass: `verifyEIP3009` computes the digest
// and recovers the signer itself — it never asks us. All we get to answer are CHAIN-STATE calls,
// which is exactly the half a chain legitimately owns. So a green result has NOT told anyone a
// broken signature is fine — the opposite of a rubber-stamp mock.
//
// WHAT WE FAKE (and only this — see fidelity.ts, which states it in every result):
//   getCode           -> "deployed" for configured contracts (the asset), EOA ("0x") otherwise
//   readContract      -> the transferWithAuthorization SIMULATION succeeds; balance/nonce answers
//   writeContract     -> a well-formed SYNTHETIC tx hash (no chain, no gas, no settlement)
//   waitForReceipt    -> success (or "reverted" when a fault is injected)
import { verifyTypedData, type Hex } from "viem";
import type { FacilitatorEvmSigner } from "@x402/evm";

/** A fixed, well-formed facilitator address. Never signs anything real — settlement is faked. */
const MOCK_FACILITATOR_ADDRESS = "0x000000000000000000000000000000000000dEaD" as const;

/** Minimal bytecode marker so `getCode` reports a "deployed" contract (non-"0x"). */
const DEPLOYED_MARKER = "0x60006000" as const;

export interface MockFacilitatorFaults {
  /** The on-chain transfer would revert at verify-time simulation (insufficient balance, a used
   *  nonce, etc.). At THIS fidelity the facilitator surfaces the generic simulation-failure reason;
   *  decomposing it into insufficient_balance vs nonce_already_used needs faithful MULTICALL3
   *  diagnostics — a fidelity rung deferred, not faked here (see fidelity.ts). */
  transferReverts?: boolean;
  /** The settlement transaction is mined but reverts (receipt status non-success). */
  settleReverts?: boolean;
}

export interface MockFacilitatorOpts {
  /** Contract addresses `getCode` should report as deployed (case-insensitive) — the asset(s). */
  deployedContracts: readonly string[];
  /** Optional balance (atomic units) balanceOf reports; defaults to a large funded balance. */
  balance?: bigint;
  /** Optional ERC-20 metadata for the failure-diagnosis path (name/version). */
  token?: { name?: string; version?: string };
  faults?: MockFacilitatorFaults;
}

/**
 * Build a `FacilitatorEvmSigner` that fakes ONLY chain state. Inject it into the real
 * `ExactEvmScheme` so the production verify/settle logic runs against faked reads — real crypto,
 * faked chain. Stateless except for a monotonic tx-hash counter so repeated settlements get
 * distinct, well-formed synthetic hashes (deterministic — no randomness).
 */
export function makeMockFacilitatorSigner(opts: MockFacilitatorOpts): FacilitatorEvmSigner {
  const deployed = new Set(opts.deployedContracts.map((a) => a.toLowerCase()));
  const balance = opts.balance ?? 1_000_000_000_000n; // 1e12 atomic units — amply funded
  const faults = opts.faults ?? {};
  let txCounter = 0;

  const syntheticTxHash = (): Hex =>
    `0x${(++txCounter).toString(16).padStart(64, "0")}` as Hex;

  return {
    getAddresses: () => [MOCK_FACILITATOR_ADDRESS],

    async getCode({ address }): Promise<Hex | undefined> {
      return deployed.has(address.toLowerCase()) ? DEPLOYED_MARKER : "0x";
    },

    // Honest even though the exact scheme never calls it: verifyEIP3009 recovers the signer itself.
    // We delegate to viem's real verifier rather than stub `true`, so this can't lie either.
    async verifyTypedData(args): Promise<boolean> {
      try {
        return await verifyTypedData(args as never);
      } catch {
        return false;
      }
    },

    async readContract({ functionName }): Promise<unknown> {
      switch (functionName) {
        case "transferWithAuthorization":
          // The verify-time simulation. Success == "would transfer". A throw models a chain-state
          // revert; the real facilitator then runs a MULTICALL3 diagnosis we don't model yet, so it
          // falls back to the generic simulation-failure reason (see MockFacilitatorFaults).
          if (faults.transferReverts) throw new Error("transfer would revert (mock chain-state fault)");
          return undefined;
        // balanceOf / authorizationState are correct benign answers, reachable only once the
        // MULTICALL3 diagnostic path is modeled (the fidelity rung above); harmless until then.
        case "balanceOf":
          return balance;
        case "authorizationState":
          return false; // nonce unused
        case "name":
          return opts.token?.name ?? "";
        case "version":
          return opts.token?.version ?? "";
        default:
          // Anything else (e.g. an unexpected read) throws loudly rather than fabricating an answer.
          throw new Error(`x402-bench mock signer: unhandled readContract "${functionName}"`);
      }
    },

    async writeContract(): Promise<Hex> {
      return syntheticTxHash();
    },

    async sendTransaction(): Promise<Hex> {
      return syntheticTxHash();
    },

    async waitForTransactionReceipt(): Promise<{ status: string; logs?: readonly never[] }> {
      return { status: faults.settleReverts ? "reverted" : "success", logs: [] };
    },
  };
}
