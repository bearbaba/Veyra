# Phase 8B — Veyra ID / Friends / Pay-by-ID Testnet acceptance gate

**Status:** acceptance specification, **not** evidence of completion. This document does not enable payment execution or deploy services.

## Goal

Show that two disposable wallets can use Veyra ID to establish identity, become friends and prepare a **recipient-bound** USDC payment on Arc Testnet through a real authenticated BFF and PostgreSQL database. An actual signed transfer is a separately recorded, opt-in acceptance step; never infer it from green unit tests.

## Non-negotiable safety boundaries

- Arc Testnet only; Mainnet money movement stays disabled.
- Use disposable wallets and small faucet/testnet balances only, never private keys or seed phrases in logs, screenshots, GitHub, or browser diagnostics.
- Preserve the current Testnet direct-pay cap (1 USDC); do not enlarge it to enable this test.
- A review token is a short-lived proof of reviewed recipient details, **not** a grant to sign or transfer.
- A static Vercel Preview is not proof that the authenticated hosted BFF/PostgreSQL stack works.
- Reject unavailable RPC, mismatched chain, stale identity, missing receipt, or incomplete verification; do not fabricate successes or retry an ambiguous payment.
- No migration to Production, no provider enablement or financial config promotion from this document.

## Staged acceptance matrix

| Gate | Required live evidence | Negative case | Pass condition |
| --- | --- | --- | --- |
| A. Backend + DB | BFF health, migrated PostgreSQL, authenticated requests across a deployed HTTPS origin | Anonymous calls to social and identity endpoints return 401; unauthorized origin rejected | Real hosted logs and sanitized request IDs; no mock-only result |
| B. Two wallet identities | Wallet A and B each register via signed Testnet ownership challenge and recover the same identity after re-login | Expired, replayed, wrong-chain, and mismatched signatures fail | Persistent DB identities and correct ownership |
| C. Friend lifecycle | A requests B; B accepts; both see CONNECTED after reload | Duplicate request, wrong actor acceptance, blocked pair rejected | DB-authoritative state agrees across sessions |
| D. Exact recipient review | A chooses B's ID, examines full address and chain, obtains short-lived sender-bound review proof | Sibling wallet, tampered address, wrong sender/chain, expired token fail | Verified wallet ID/address/chain frozen at Review |
| E. Blocking race | B blocks A after A's review token is issued | Previously valid proof used after block | Backend refuses with RECIPIENT_BLOCKED; no wallet signing prompt |
| F. Unblock semantics | B unblocks A | Old friendship quietly restored | Not CONNECTED until new request and acceptance |
| G. Optional Testnet transfer | A confirms one explicitly reviewed USDC transfer, then examines transaction and Activity receipt | RPC/receipt ambiguity, double-click, reload/retry after broadcast | Exactly one transaction; authoritative matching receipt, no duplicate submission |
| H. Release boundary | Existing CI, browser, RPC and PostgreSQL gates remain green | Accidental Mainnet signing, provider enablement or Production rewrite | Fail closed; reviewers approve separately |

## Suggested operator procedure

1. Use an isolated Testnet environment with a real migrated PostgreSQL database, a hosted BFF, configured HTTPS origin and two disposable browser wallets. Record the commit SHA, environment, network chain ID and time.
2. Confirm deployment is for that **exact SHA**, health checks pass, and no secrets, private keys or personally identifying wallet data enter CI logs.
3. Confirm BFF endpoints reject anonymous requests before attempting any wallet-linked requests. For authenticated testing, verify cookie/session ownership and origin enforcement in live HTTP calls.
4. Complete gates B–F in order with both wallets, using fresh sessions. Re-check social block state immediately before confirming an ID-bound review.
5. Before any optional transfer, show the recipient's **full address, wallet selection, chain, asset, amount, and fee**. Require explicit wallet approval; do not permit an AI agent or the server to sign.
6. If performing gate G, use a disposable faucet-funded Testnet wallet and capture a redacted tx hash, canonical chain receipt, before/after balance, Activity status and reload result. On any uncertain broadcast state, **reconcile first, never send again automatically**.
7. Attach a concise pass/fail report to the PR; report FAIL/SKIPPED honestly. Reviewers must not approve a general Pay-by-ID launch based only on mocked wallets or unit tests.

## Evidence template

```text
Commit SHA:
Target branch:
Environment (Testnet only):
BFF URL / deployment ID (no credentials):
Database migration / health evidence:
Wallet A / wallet B (redacted):
Arc Testnet chain ID:
Gates A–H: PASS / FAIL / SKIPPED, evidence link per gate:
Tx hash (only if explicitly executed):
Duplicate-broadcast/reload reconciliation:
Unresolved blockers:
Reviewer decision and date:
```

## Required release decision

Pay-by-ID and Friends must remain labeled as **not live** until authenticated hosted BFF + PostgreSQL + two-wallet acceptance succeeds. Green CI demonstrates test coverage, not deployed readiness, independent security review, or Mainnet permission.

Related sources: `docs/veyra-phase8a-social-payment-security.md`, `docs/veyra-phase7e-payment-review-binding.md`, and `docs/veyra-id-friends-pay-foundation.md`.
