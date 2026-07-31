// A local HTTP endpoint that answers with a GENUINE x402 402 challenge, encoded exactly the way a
// real @x402 resource server does — v2 puts the PaymentRequired in a base64 `PAYMENT-REQUIRED`
// header (via the SDK's own `encodePaymentRequiredHeader`), v1 puts it in the JSON body with
// `x402Version: 1`. The wire is byte-identical to what a production server emits, so the real @x402
// CLIENT parses it exactly as it would in the wild — letting you drive the whole flow (402 ->
// pay -> verify -> settle) against x402-bench with no chain and no live resource server.
import { createServer, type Server } from "node:http";
import { encodePaymentRequiredHeader, decodePaymentRequiredHeader } from "@x402/core/http";
import { validatePaymentRequired } from "@x402/core/schemas";
import type { PaymentRequired } from "@x402/core/types";

export interface LocalServer {
  /** The resource URL a client hits; every request answers 402 with the given challenge. */
  url: string;
  close(): Promise<void>;
}

/**
 * Serve `paymentRequired` as a real 402 over localhost. The encoding follows the generation:
 * `x402Version === 2` -> base64 `PAYMENT-REQUIRED` header; otherwise (v1) -> JSON body. Binds to an
 * ephemeral port so callers never collide. SELF-CERTIFIES the wire via the SDK's own schema check
 * (and, for v2, a real encode+decode round-trip) so we serve genuine wire, not a lenient shape the
 * client merely tolerates — if it throws, the harness is a fiction; fail loudly at setup.
 */
export async function startX402Server(paymentRequired: PaymentRequired): Promise<LocalServer> {
  const isV2 = (paymentRequired as { x402Version?: number }).x402Version === 2;
  const wireForm: unknown = isV2
    ? decodePaymentRequiredHeader(encodePaymentRequiredHeader(paymentRequired))
    : paymentRequired;
  validatePaymentRequired(wireForm);

  const server: Server = createServer((_req, res) => {
    res.statusCode = 402;
    res.setHeader("content-type", "application/json");
    // Close the socket after each response (no HTTP/1.1 keep-alive) so `server.close()` doesn't
    // hang on an idle keep-alive socket toward the timeout.
    res.setHeader("Connection", "close");
    if (isV2) {
      res.setHeader("PAYMENT-REQUIRED", encodePaymentRequiredHeader(paymentRequired));
      res.end(JSON.stringify({ error: "payment required" }));
    } else {
      res.end(JSON.stringify(paymentRequired));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}/resource`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
