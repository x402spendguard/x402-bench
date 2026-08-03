// The CLI planner is pure, so we can prove the two things the stranger audit flagged WITHOUT spawning
// the bin: (1) `--help`/`-h` routes to a help plan and NEVER to serve — so the bin prints usage and
// exits instead of silently booting the server and hanging; (2) flags/faults parse as documented.
import { describe, it, expect } from "vitest";
import { planFromArgv, USAGE } from "../src/cli-plan.js";

describe("x402-bench CLI planning (pure; --help can never start the server)", () => {
  it("help-flag-plans-help-not-serve", () => {
    expect(planFromArgv(["--help"]).action).toBe("help");
    expect(planFromArgv(["-h"]).action).toBe("help");
    // Help wins even alongside serve flags -> usage prints and the bin exits; the server never boots.
    expect(planFromArgv(["--port", "3402", "--help"]).action).toBe("help");
  });

  it("defaults-plan-serve", () => {
    const p = planFromArgv([]);
    expect(p.action).toBe("serve");
    if (p.action === "serve") {
      expect(p.port).toBe(3402);
      expect(p.network).toBe("eip155:84532");
      expect(p.faults).toBeUndefined();
      expect(p.quiet).toBe(false);
    }
  });

  it("parses-flags-and-maps-faults", () => {
    const p = planFromArgv(["--port", "9999", "--fault", "insufficient_balance", "--quiet"]);
    expect(p.action).toBe("serve");
    if (p.action === "serve") {
      expect(p.port).toBe(9999);
      expect(p.faults).toEqual({ transferReverts: "insufficient_balance" });
      expect(p.faultLabel).toBe("insufficient_balance");
      expect(p.quiet).toBe(true);
    }
  });

  it("usage-documents-every-flag", () => {
    for (const f of ["--port", "--network", "--asset", "--token-name", "--token-version", "--fault", "--quiet", "-h, --help"]) {
      expect(USAGE).toContain(f);
    }
  });
});
