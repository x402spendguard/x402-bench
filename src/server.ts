// The runnable x402-bench facilitator — a local HTTP facilitator your real @x402 client can point
// at. It speaks the exact facilitator wire (`POST /verify`, `POST /settle`, `GET /supported`) that
// `@x402/core`'s HTTPFacilitatorClient calls, so a production client talks to it unchanged.
//
// THE HONESTY SPINE ON THE WIRE: every response carries an `x-bench-fidelity` HEADER stating what
// was real vs. simulated. It rides in a header (never the JSON body) so it can't break the client's
// response-schema validation, yet is present on every single reply. The CLI prints the full banner
// loudly on startup. A user who never reads this source still gets told, on every response, that a
// green proves SHAPE, not chain-acceptance.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { BenchFacilitator, type BenchFacilitatorOpts } from "./bench-facilitator.js";

/** Compact per-response fidelity statement (the full text lives in fidelity.ts / the CLI banner). */
const FIDELITY_HEADER =
  "signature=verified; chain=simulated; settlement=synthetic; green-proves-shape-not-chain-acceptance";

/** A single handshake through the facilitator, surfaced for the inspector. Data, not presentation —
 *  the CLI renders it; tests assert on it. Fidelity is constant (sig real, chain faked) by design. */
export interface BenchEvent {
  route: "verify" | "settle" | "supported";
  /** accepted/rejected for verify+settle; omitted for supported. */
  verdict?: "accepted" | "rejected";
  /** invalidReason / errorReason when rejected. */
  reason?: string;
  payer?: string;
  payTo?: string;
  amount?: string;
  asset?: string;
  /** The synthetic tx hash, on an accepted settle. */
  transaction?: string;
}

export interface BenchServerOpts extends BenchFacilitatorOpts {
  /** Port to listen on. Default 3402; pass 0 for an ephemeral port (tests). */
  port?: number;
  /** Host to bind. Default 127.0.0.1 (local only — this is a dev tool, not a public facilitator). */
  host?: string;
  /** Called once per handshake — the inspector tap. The CLI wires a live printer; tests capture. */
  onEvent?: (event: BenchEvent) => void;
}

export interface RunningBenchServer {
  /** Base URL to hand a client's facilitator config, e.g. `new HTTPFacilitatorClient({ url })`. */
  url: string;
  port: number;
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/** JSON with bigint -> string, matching how @x402 serializes facilitator payloads. */
const jsonReplacer = (_: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

/**
 * Start the bench facilitator HTTP server. Returns its URL + a close handle. The chain is faked and
 * signatures are verified for real (see BenchFacilitator); fault injection lives in `opts.chain.faults`.
 */
export async function startBenchServer(opts: BenchServerOpts): Promise<RunningBenchServer> {
  const facilitator = new BenchFacilitator(opts);

  const send = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, {
      "content-type": "application/json",
      "x-bench-fidelity": FIDELITY_HEADER,
      connection: "close",
    });
    res.end(JSON.stringify(body, jsonReplacer));
  };

  // The inspector tap: summarize a handshake and hand it to opts.onEvent (if any). Read-only over
  // untrusted JSON, so every field is optional-and-defensive.
  const emit = (route: BenchEvent["route"], rawPayload: unknown, rawReq: unknown, result: unknown): void => {
    if (!opts.onEvent) return;
    const p = rawPayload as { payload?: { authorization?: { from?: string } } };
    const r = rawReq as { payTo?: string; amount?: string; asset?: string };
    const out = result as { isValid?: boolean; success?: boolean; invalidReason?: string; errorReason?: string; transaction?: string };
    const accepted = route === "verify" ? out.isValid === true : out.success === true;
    opts.onEvent({
      route,
      verdict: accepted ? "accepted" : "rejected",
      reason: accepted ? undefined : out.invalidReason ?? out.errorReason,
      payer: p.payload?.authorization?.from,
      payTo: r.payTo,
      amount: r.amount,
      asset: r.asset,
      transaction: route === "settle" && accepted ? out.transaction : undefined,
    });
  };

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = req.url ?? "";
        const method = req.method ?? "GET";
        if (method === "GET" && url.startsWith("/supported")) {
          opts.onEvent?.({ route: "supported" });
          send(res, 200, facilitator.getSupported());
          return;
        }
        if (method === "POST" && (url.startsWith("/verify") || url.startsWith("/settle"))) {
          const parsed = JSON.parse((await readBody(req)) || "{}") as {
            paymentPayload?: unknown;
            paymentRequirements?: unknown;
          };
          if (!parsed.paymentPayload || !parsed.paymentRequirements) {
            send(res, 400, { error: "missing paymentPayload or paymentRequirements" });
            return;
          }
          const payload = parsed.paymentPayload as never;
          const requirements = parsed.paymentRequirements as never;
          const isVerify = url.startsWith("/verify");
          const { result } = isVerify
            ? await facilitator.verify(payload, requirements)
            : await facilitator.settle(payload, requirements);
          emit(isVerify ? "verify" : "settle", parsed.paymentPayload, parsed.paymentRequirements, result);
          send(res, 200, result);
          return;
        }
        send(res, 404, { error: `x402-bench: no route for ${method} ${url}` });
      } catch (err) {
        send(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    })();
  });

  const host = opts.host ?? "127.0.0.1";
  const requestedPort = opts.port ?? 3402;
  await new Promise<void>((resolve) => server.listen(requestedPort, host, () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : requestedPort;
  return {
    url: `http://${host}:${port}`,
    port,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
