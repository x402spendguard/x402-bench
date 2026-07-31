// The chain-faking half of x402-bench — a MOCK FacilitatorEvmSigner.
//
// THE HONESTY INVARIANT (why x402-bench is not a rubber-stamp): we do NOT write a facilitator. This
// signer is injected into the REAL @x402/evm `ExactEvmScheme` (via the real `x402Facilitator`), so
// every DETERMINISTIC security check runs in the production library, unmodified:
//   - EIP-712 digest hashing + ECDSA signer recovery  (recoverAddress, in-library)
//   - recipient / value / network / scheme match
//   - validAfter / validBefore time-window checks
// A mock signer STRUCTURALLY CANNOT make a bad signature pass: `verifyEIP3009` computes the digest
// and recovers the signer itself — it never asks us. All we get to answer are CHAIN-STATE calls.
//
// WHAT WE FAKE (and only this — see fidelity.ts, which states it in every result):
//   getCode           -> "deployed" for configured contracts (the asset), EOA ("0x") otherwise
//   readContract      -> the transfer SIMULATION; and the facilitator's MULTICALL3 failure-diagnosis
//   writeContract     -> a well-formed SYNTHETIC tx hash (no chain, no gas, no settlement)
//   waitForReceipt    -> success (or "reverted" when a fault is injected)
//
// PRECISE FAULT REASONS ARE HONEST HERE: when you inject a *specific* cause (insufficient_balance /
// nonce_used), we answer the facilitator's diagnostic reads so its OWN diagnosis lands on that
// reason. We are not inventing a reason — we are letting the real facilitator diagnose the chain
// state we were told to simulate. An unspecified `transferReverts: true` yields the generic reason.
import { verifyTypedData, toFunctionSelector, encodeAbiParameters, type Hex } from "viem";
import type { FacilitatorEvmSigner } from "@x402/evm";

/** A fixed, well-formed facilitator address. Never signs anything real — settlement is faked. */
const MOCK_FACILITATOR_ADDRESS = "0x000000000000000000000000000000000000dEaD" as const;

/** Minimal bytecode marker so `getCode` reports a "deployed" contract (non-"0x"). */
const DEPLOYED_MARKER = "0x60006000" as const;

/** Selectors for the reads the facilitator's failure-diagnosis MULTICALL3 issues. */
const SEL = {
  balanceOf: toFunctionSelector("function balanceOf(address)"),
  name: toFunctionSelector("function name()"),
  version: toFunctionSelector("function version()"),
  authorizationState: toFunctionSelector("function authorizationState(address,bytes32)"),
} as const;

export interface MockFacilitatorFaults {
  /** Inject a chain-state failure that makes the transfer revert at verify time. Name a specific
   *  cause and x402-bench answers the facilitator's MULTICALL3 diagnosis so the rejection reason is
   *  PRECISE (invalid_exact_evm_insufficient_balance / _nonce_already_used). `true` = a generic
   *  revert (the facilitator returns its generic simulation-failed reason). */
  transferReverts?: boolean | "insufficient_balance" | "nonce_used";
  /** The settlement transaction is mined but reverts (receipt status non-success). */
  settleReverts?: boolean;
}

export interface MockFacilitatorOpts {
  /** Contract addresses `getCode` should report as deployed (case-insensitive) — the asset(s). */
  deployedContracts: readonly string[];
  /** Optional funded balance (atomic units) balanceOf reports; defaults to a large balance. */
  balance?: bigint;
  /** ERC-20 metadata for the diagnosis path — should match the requirement's `extra` for a clean
   *  precise diagnosis (a mismatch would make the facilitator report a token-metadata error first). */
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
  const fundedBalance = opts.balance ?? 1_000_000_000_000n; // 1e12 atomic units — amply funded
  const faults = opts.faults ?? {};
  const tokenName = opts.token?.name ?? "";
  const tokenVersion = opts.token?.version ?? "";
  // Fault-derived chain state, so the facilitator's own diagnosis lands on the precise reason.
  const balanceReported = faults.transferReverts === "insufficient_balance" ? 0n : fundedBalance;
  const nonceUsed = faults.transferReverts === "nonce_used";
  let txCounter = 0;

  const syntheticTxHash = (): Hex => `0x${(++txCounter).toString(16).padStart(64, "0")}` as Hex;

  // Answer one diagnostic sub-call (from the facilitator's MULTICALL3) by its function selector.
  const diagnosticReturn = (callData: string): Hex => {
    const sel = callData.slice(0, 10).toLowerCase();
    if (sel === SEL.balanceOf) return encodeAbiParameters([{ type: "uint256" }], [balanceReported]);
    if (sel === SEL.authorizationState) return encodeAbiParameters([{ type: "bool" }], [nonceUsed]);
    if (sel === SEL.name) return encodeAbiParameters([{ type: "string" }], [tokenName]);
    if (sel === SEL.version) return encodeAbiParameters([{ type: "string" }], [tokenVersion]);
    return "0x";
  };

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

    async readContract({ functionName, args }): Promise<unknown> {
      switch (functionName) {
        case "transferWithAuthorization":
          // Verify-time simulation. Success == "would transfer". A throw models a chain-state revert;
          // the facilitator then runs its MULTICALL3 diagnosis (tryAggregate) to pin down WHY.
          if (faults.transferReverts) throw new Error("transfer would revert (mock chain-state fault)");
          return undefined;
        case "tryAggregate": {
          // MULTICALL3: args = [requireSuccess, [{ target, callData }, ...]]. Answer each sub-call so
          // the facilitator's failure diagnosis reaches the precise reason (balance / nonce / metadata).
          const calls = (args?.[1] as Array<{ callData: string }> | undefined) ?? [];
          return calls.map((c) => ({ success: true, returnData: diagnosticReturn(c.callData) }));
        }
        case "balanceOf":
          return balanceReported;
        case "authorizationState":
          return nonceUsed; // true == nonce already used
        case "name":
          return tokenName;
        case "version":
          return tokenVersion;
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
