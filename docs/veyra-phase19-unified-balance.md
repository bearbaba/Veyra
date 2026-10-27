# Phase 19 — read-only Arc Testnet USDC balance

**Current scope:** one verified on-chain token balance for the connected wallet on Arc Testnet. This is not cross-chain unified spendability, a USD portfolio valuation or a Mainnet payment authorization.

- Derive the amount from the pinned Arc Testnet `USDC.balanceOf(wallet)` contract call. Reads use a fixed chain independent of the connected wallet's signing chain.
- Display all necessary decimals (two minimum, six maximum) using bigint-safe string formatting. `0.00` is shown only after successful RPC response returning zero.
- Reload on focus, poll every 30 seconds while mounted, and offer manual refresh. Display a client-side last-read time, not an assertion of block finality.
- Distinguish disconnected, reading, RPC failure and available states. Never display a stale success balance after RPC error.
- Keep all other recognized networks and assets non-executable unless explicitly reviewed. Never estimate a combined USD amount from unsupported chains.
- Never request a wallet signature for balance reads. Mainnet guard prevents Arc Testnet balance reads in Mainnet mode.

**Manual acceptance gate:** actual incoming/outgoing USDC, wallet switching, F5 restore, network mismatch, RPC outage/recovery, mobile long amounts and read-only states. Do not promote or merge merely because Preview builds.
