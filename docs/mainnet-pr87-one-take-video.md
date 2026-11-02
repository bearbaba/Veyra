# PR #87 — One-take Mainnet acceptance video

**Candidate:** use the newest READY Preview whose Git SHA matches PR #87. Do not test an older preview or the Production URL. The Pay page must show `REAL MAINNET Preview` and the first 12 characters of the commit.  
**Safety:** every transfer spends real USDC. Use only Wallet A and Wallet B owned by the tester, fund minimally for the route and gas, record no seed phrases, wallet recovery prompts, private tokens or session cookies. Do not trigger real RPC faults or deliberately burn funds. Do not record existing unrelated wallet transactions.

## Single recording: user-facing flow (P01–P06)

| Scene | What to show in one uninterrupted recording | Acceptance evidence |
| --- | --- | --- |
| 0. Build identity | Preview URL, exact commit banner, Arc Mainnet 5042, two distinct abbreviated Wallet A/B addresses. Confirm both wallets are yours. | Screenshot of release SHA + chain |
| 1. Direct wallet Pay (P01) | Connect A, choose **Wallet transfer**, enter B, enter a controlled small USDC amount, review, confirm once. Open **Activity**; wait for verified receipt. Show B's wallet balance/USDC Transfer in Explorer. | Original direct Pay hash; amount received by B; no hash pasted |
| 2. Contract Pay requiring Approve (P02) | Switch to **Contract payment**, choose A→B and amount. Use an A wallet with insufficient allowance for the exact contract; if not available, mark P02 BLOCKED (never force extra onchain transactions to manufacture it). Show `Approve` then success, then separate `Pay`, then receipt. | Approve hash, contract pay hash, actual allowance and PaymentSettled |
| 3. Already-approved Contract Pay (P03) | Choose a permitted amount that is already covered by a genuinely existing allowance. Show review→Pay without a second approval. If allowance was consumed completely, mark BLOCKED. | Contract pay hash, no new Approve prompt |
| 4. Cancel wallet signing (P04) | Prepare another payment but **Reject** in wallet before broadcast. Show cancellation and that no new payment appears in Activity. Do not send it just to test rejection. | Screenshot of rejection, no tx hash |
| 5. Navigate / reload (P05–P06) | While a previously sent tx is pending **if naturally possible**, navigate to Activity, return to Pay, refresh, show original wallet/recipient, tx hash and verified result. Do not race an irreversible signing action solely to create a timeout. | Original hash and same state before/after reload, no duplicate signing |
| 6. Closing scene | Return to Activity. Show direct and contract receipts, B's received transfer(s) and the original Preview commit. | Short clip, hashes and final PASS/FAIL/BLOCKED notes |

**Stop the recording if recipient, network or amount differs from the review. Do not sign a “retry” when the original result is unknown.** It is legitimate to mark P05/P06 BLOCKED if the natural pending window was too brief; the developer's simulated tests carry the abnormal cases.

## Developer-owned deterministic fault evidence (P07–P08, P10–P11)

Record GitHub Actions exact commit URL plus the Vitest failure-injection test output. These tests do not spend Mainnet funds:
- Storage write throws: signing must not start; unknown journal remains.
- Wallet/RPC ambiguous response and missing tx hash: lock persists and **Check original transaction again** does read-only reconciliation; no event is never proof of failure.
- Iris HTTP 429, network/CORS failure and empty response: Bridge stays UNVERIFIED.
- Unrelated, correct-looking CCTP destination receipt: reject by nonce/header/immutable burn amount/recipient/token.
- Emergency rollback: `release/rollback-readonly-pr87` build blocks signing at Pay, Settlement, Swap and Bridge execution paths while Activity continues reading old/new journals.

**Do not ask the wallet tester to intentionally create RPC failures, revert real transactions or perform a cross-chain bridge for these negative-path tests.**

## Decision after the one video

- Pay P01–P06 PASS or explicitly documented BLOCKED with adequate simulator evidence P07–P08; no false VERIFIED, no duplicate send, no wrong wallet/recipient.
- If Pay gates pass, release only Pay/Settlement with Production Bridge signing **disabled** at the execution layer. Bridge P09–P11 are a *separate* release gate.
- Verify a compatible read-only rollback preview and its CI, then prepare Production delivery; do not roll back to `0d3b04f` if a new journal is unresolved.
- After human review, deploy the accepted commit to Production, verify alias+SHA, run controlled Production smoke, and record results in `docs/mainnet-pr87-acceptance.md`.
- Without a real-wallet recording and independent explorer receipts, keep the PR Draft and Production unchanged.

## Evidence notes to accompany the video

```
PR #87 HEAD commit:
Preview URL:
Wallet A and B (truncated addresses):
P01 direct tx hash / amount / result:
P02 approval tx + contract payment tx / result:
P03 sufficient allowance + contract payment hash / result:
P04 rejected signature / no new tx:
P05 reload after hash / original tx:
P06 navigation / restored state:
Fault-injection workflow URL:
Compatible rollback commit / Preview URL:
Bugs observed (timestamp, screen, expected vs actual):
Overall recommendation: GO PAY ONLY / NO GO
```
