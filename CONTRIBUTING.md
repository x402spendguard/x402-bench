# Contributing

## Before you push: `npm run verify`

Run **`npm run verify`** before every push. It mirrors CI, so a green `verify`
means a green CI:

1. `npm run typecheck`
2. `npm test`
3. `npm run build` — the `bin` (`dist/cli.js`) is a shipped artifact, so a broken
   build must fail here, not on a user's machine.

CI additionally smoke-runs the built bin (`node dist/cli.js --help` must print
usage and **exit**, never hang).

## The one invariant that matters

x402-bench's whole reason to exist is that it **does not rubber-stamp**: it runs
the *real* `@x402` signature + authorization checks and fakes only the chain, and
it **labels which is which on every result** (the `fidelity` field / the
`x-bench-fidelity` header / the startup banner). Any change must preserve both:
real crypto (a bad signature is rejected — see the differentiator test) and honest
labeling (never assert a check it didn't perform). If you add fidelity, add a label.

## Flow

- Keep `main` green; `npm run verify` before pushing.
- Commit messages explain the *why*.
