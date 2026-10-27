# Phase 20 — Agent amount and network fidelity

Regression found in the 2026-10-27 screenshot: Vietnamese instruction to send **2 USDC to a wallet on Base** was displayed as **0 USDC** and **Ready to review**.

## Root cause
1. Local fallback parser matched the leading digit `0` from `0x…` as a transfer amount. It now removes hex-address-like fragments before amount detection, preferring numbers adjacent to known asset symbols.
2. Generic intent schema equated a nonempty amount with a positive financial amount. Zero, negative, malformed and ambiguous amounts now demand clarification.
3. Agent card exposed Review for an explicitly requested unsupported source network. A single Arc Testnet-only USDC handoff guard now checks the Agent card and the Pay session handoff. No route is silently rewritten.

## Release scope
- Supported transfer draft: positive six-decimal USDC amount, recipient, and Arc Testnet (or unspecified chain; Pay labels Arc explicitly).
- Unsupported: Base/Ethereum/other explicit direct-transfer routes, EURC, nonpositive or ambiguous money, malformed wallet address.
- Cross-chain Bridge planning is outside this narrow direct-pay gate and still passes independent provider readiness; Mainnet stays locked.
- A green build is not wallet-level execution acceptance. No Production promotion or Render deployment in this change.

## Manual checks
Send a wallet-first `2 USDC` request for Arc, verify the card and Pay prefill; repeat on Base and verify Review is absent; retry `0 USDC`, `2,5 USDC` (ambiguous), missing amount, wallet switch, reload and mobile view. Actual blockchain transaction still requires explicit wallet signature and policy checks.
