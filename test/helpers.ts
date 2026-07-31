// Shared test helper: produce a REAL signed exact/EIP-3009 payment via the real @x402 client and a
// throwaway account (real crypto, no funds), against a genuine local 402. Used by every test so the
// payloads under test are the same ones a production client emits.
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { startX402Server } from "../src/mock-resource-server.js";

export const CHAIN = "eip155:84532";
export const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
export const AMOUNT = "10000"; // atomic USDC (6 decimals) -> 0.01 USDC

/** A fresh, lowercased throwaway address (a payee or a payer that never holds funds). */
export function randomAddress(): string {
  return privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
}

/** Produce a genuine signed payment for `AMOUNT` -> `payTo`. No guard, no funds — just real crypto. */
export async function makePayment(payTo: string): Promise<{ payload: PaymentPayload; requirement: PaymentRequirements }> {
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
