# PR #87 Mainnet P0 — acceptance and controlled release

**Production baseline:** `0d3b04f`, unchanged until acceptance. **Branch:** `fix/mainnet-p0-journal-cctp-link` (Draft PR #87).  
**Networks:** Arc Mainnet 5042, Base Mainnet 8453. **Funds:** real USDC — owner-controlled small amounts only. No Testnet wallet assumptions.

## Stage 0 — verify the exact build

1. Open the newest Vercel READY Preview **for the exact PR HEAD SHA**, not an older branch alias. Its Pay header displays a 12-character commit and warns it is REAL MAINNET. Attach screenshot.
2. Check the SHA, Vercel Preview target, build environment, Arc USDC contract, VeyraSettlement contract, RPC source, Base USDC and Circle Iris URL. Compare to intended Production. A Preview READY response alone is not proof of provider connectivity or wallet E2E.
3. Confirm GitHub Actions **for this exact SHA**: TypeScript, lint, Mainnet unit/behavioral tests, production build, bundle isolation. Red or skipped step = NO GO.

## Stage 1 — two controlled wallets (A/B)

Mark each row PASS / FAIL / BLOCKED / NOT RUN. Start as NOT RUN. Attach dated original hash, explorer link, shortened public addresses and screenshot/video; **never put seed/private keys in evidence**.

| Case | Real/manual acceptance condition | Current |
| --- | --- | --- |
| P01 Direct Pay A→B | B gets exact USDC; Activity independently verifies; no hash pasted | NOT RUN |
| P02 Contract Pay new allowance | Approve once and verify, then Pay exactly reviewed amount/recipient | NOT RUN |
| P03 Contract Pay sufficient allowance | Skip Approve; one Pay signature | NOT RUN |
| P04 Explicit user signature rejection | Shows cancellation without a payment, new review safe | NOT RUN |
| P05 Reload after original tx hash | Same payment recovered; no new signature, same receipt in Activity | NOT RUN |
| P06 Navigate away during signing | Method remains locked; original recipient and amount preserved | NOT RUN |
| P07 RPC timeout / unknown wallet response | Clear UNKNOWN explanation and read-only **Check original transaction again**; no automatic resend | NOT RUN — fault-injection allowed |
| P08 Hashless broadcast | Search canonical PaymentSettled(ref) / Approval events starting at pre-sign block; no match NEVER unlocks journal | NOT RUN — fault-injection allowed |
| P09 CCTP Bridge (controlled wallets) | Circle Iris message, immutable burn token/amount/recipient and destination MessageReceived nonce match; destination USDC received | NOT RUN |
| P10 Iris 404/429/CORS/timeout | No VERIFIED result; no duplicate bridge; retry read-only | NOT RUN — fault-injection allowed |
| P11 Valid but unrelated mint or incorrect nonce | Must be rejected, even if unrelated destination amount is correct | AUTOMATED fixture only; check workflow |
| P12 Post-release Production smoke | Same SHA on official domain, existing recovery journal accessible, one small owner-approved transfer if safe | NOT RUN |

## Evidence record for EACH case

```
Case ID:
Date / UTC time:
Full Git SHA:
Preview or Production URL:
Wallet A / B abbreviated address (public only):
Chain ID and asset:
Initial balance / allowance / original intent:
Steps taken:
Original approve / pay / burn / mint hash(es):
Expected result:
Actual result and verdict (PASS / FAIL / BLOCKED / NOT RUN):
Explorer and Circle Iris response refs:
Screenshot / short video link:
Observed issue / fix commit:
Verifier:
```

## Release decision (explicit finish line)

**GO Pay + Settlement only:** P01–P08 pass, including UNKNOWN recovery and no duplicate signing. Fix any production-blocking regression. Keep **new Bridge signing disabled at the execution layer** in Production until P09–P11 have real/negative evidence; never pretend provider tracking is a verified receipt.

**GO Bridge:** P09 real source→destination proof, P10 unavailable-Iris behavior, P11 unrelated mint rejection pass. Explicitly enable production Bridge write flag only after this stage.

**NO GO:** wrong recipient/amount, missing original task, fabricated success, duplicate transfer, invisible wallet method switch, uncertain request silently unlocked, missing CCTP link, or unverified release SHA.

**Rollback trap:** old build `0d3b04f` does not read the new Settlement intent journal. Do not roll back a Production deployment with unresolved #87 intents to a build that ignores that journal. Make a compatible rollback build which retains the reader, or pause signing until all intents resolve. Source rollback never reverses onchain transfers.

**Product follow-on:** finish issue #88 (one canonical task/receipt across Activity/Swap/Bridge), then issue #89 (verified Production Veyra ID → Friends → Send by ID → shared receipt). X Tip and Chat after identity ownership is proved.

**Release status:** Automated CI can be PASS while all genuine wallet E2E checks remain NOT RUN; do not call this Mainnet acceptance completed without attached wallet evidence.
