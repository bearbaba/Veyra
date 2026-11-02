# Veyra — Product Standard & End-to-End Acceptance
Version: 1.1 · 2026-11-02 · Product owner direction

## North star
Veyra is **a human-first USDC payments app**, not a blockchain dashboard. Someone unfamiliar with chains, transaction hashes, signatures and bridges should still be able to find a person, review a payment, authorize only what is necessary, and revisit an authentic receipt.

**One canonical user-facing web app:** https://veyra-seven-beta.vercel.app/. Internal API services and previews are not separate wallet-connect websites. **Default language: English.** Vietnamese is an optional locale. Desktop and mobile must support the same essential actions.

## Hard product invariants
1. **One identity:** One active Veyra account/ID maps to verified wallet bindings and, when available, an independently OAuth-verified X account. Veyra ID is used consistently by Friends, Pay, Tip and Chat. X is not a substitute for wallet ownership. Never silently create a second ID or trust an arbitrary X handle as an account claim. Wallet rotation and disconnect must invalidate stale payment authority.
2. **One payment journey, no friendship gate:** People → find a server-verified Veyra ID → enter USDC amount → Review (person, actual receiving wallet, network, amount, fees, available source) → explicit authorization → Track original transaction → Completed only after independent proof → private two-sided receipt views backed by the same canonical evidence. **A verified recipient can receive immediately without accepting a Friend invitation**. Friends is optional convenience for repeat payments, Tip and Chat. Regular users never need to paste a transaction hash; original-hash recovery belongs under Advanced.
3. **Two distinct sources of funds:** *Wallet USDC* is directly owned by the connected wallet; *Unified Gateway balance* is an independently funded/deposited provider balance, not another wallet balance and not automatically spendable. Show available/pending amounts separately. Select a valid source within Send/Swap/Bridge where the relevant provider supports it. Never add funds twice into one misleading total.
4. **No phantom completion:** A wallet popup, provider quote, pending hash, or frontend 200 is not a verified transfer. Use explicit stages: Review → Sign → Track → Complete / Failed / Needs attention. Each screen (Home, People, Chat, Agent, Activity) reads the same durable operation/receipt identity rather than inventing local success.
5. **No duplicate financial action:** Persist intent before signing; correlate chainId, owner, recipient, token, amount, provider and original hash or provider order ID. On timeout, reload or lost connection, reconcile the *original* action before offering another. Never auto-sign, auto-send or silently reroute to a new receiving wallet.
6. **Privacy, without false blockchain secrecy:** Within Veyra, private contacts, conversations, notes, identity metadata and authenticated receipt history are accessible only to authorized users; both payment parties may see their own private representation of the same verified receipt. Sender-private notes must not reach recipients. Enforce server-side ownership for every private read/write. **Public blockchain transactions, addresses and explorer data remain publicly observable**: never promise that onchain payments or their metadata are inherently private.
7. **Trust, fees and minimal authorization:** Every balance and transaction cites its source, last-updated state and network where relevant. Network, fees, slippage, expiration, min received, risks and recovery must be visible **before any signature**. A simple direct wallet-to-wallet USDC transfer should normally need only the necessary transfer signature. Contract Pay, Swap or Gateway may require additional approvals/signatures; show their number and purpose in advance, request the minimum permissions required, and never sign unnecessarily. Explicitly distinguish contract payment from escrow and avoid guarantee/refund language unless actually implemented.
8. **Graceful feature gates:** Unverified Mainnet providers, X OAuth, Swap, Bridge, Gateway, Agent and Chat must show an honest unavailable explanation; they cannot masquerade as live or redirect wallet connection to a Preview/Testnet application.
9. **Production quality in every slice:** Security, recovery, responsive mobile behavior, accessibility, realistic loading/error states and basic performance budgets are acceptance criteria for **every** milestone. The final quality phase is for holistic regression, load testing, operational readiness and scaling, not an excuse to defer basics.

## Navigation, responsibilities, information hierarchy
| Area | Job for the user | Primary content |
|---|---|---|
| Home | Know what money I can use and what needs attention | Wallet balance; separated Gateway available/pending; Send/Receive; most recent original operations |
| People | Find and pay a verified person immediately; optionally connect | Veyra ID, verified wallet, optional Friend state, clear Pay/Tip/Chat actions |
| Pay / Send | Move USDC to a verified person or explicit wallet | Source selector when supported, amount, clear approvals/signatures, original receipt |
| Swap | Exchange supported assets | Real quote and provider, gas/fees, slippage/min receive/expiry, approve/sign, actual output evidence |
| Bridge | Move between supported chains | Origin/destination, actual provider quote, fees/minimum, source burn/lock and destination mint/receive proof |
| Gateway / Unified | Deposit and distribute supported USDC funding | Provider-funded balance, supported routes, available vs pending, ledger/recovery |
| Chat | Communicate with trusted person | Conversation tied to the same Veyra ID; payments link to canonical receipt |
| Agent | Assist, never fabricate a transaction | A concise guided review/sign/track flow; no duplicate embedded Bridge app |
| Activity | Reopen everything safely | Persistent sender/recipient history with statuses, original hashes and explorer evidence |

## One canonical roadmap, ordered by user outcomes
All four milestones include security, recovery, mobile UX, accessibility and performance. They are NOT separate quality phases. Do not ship a stage simply because more features or tests were added.

**M0 — Human Payments (the only active next milestone)**
- Two independently wallet-authenticated Veyra accounts A and B, each bound to the correct Arc 5042 receiving wallet, on **one official website**.
- A searches for B by `@handle.veyra`, independently verifies the exact receiving address and can pay immediately. **No Friend request, X, Chat or Gateway is required**.
- A reviews amount, real network/token, fees and the minimum required wallet signatures. For ordinary direct USDC Pay, target one transfer authorization, not a blanket guarantee for future operations.
- A signs once in the approved direct-transfer flow; Veyra persists intent, automatically follows the **original** transaction, verifies canonical chain evidence, and indexes a receipt.
- A sees **Sent**, B sees **Received**, both referencing the identical verified chain transaction in owner-scoped server history. Sign out; sign in on another device; open that same receipt again. No manual hash needed in the normal journey.
- An optional Friend invitation can be sent before or after payment; it must never gate Pay. Finish People, Pay, Receipt UX in this milestone, including mobile.
- Failure acceptance: wrong wallet/network, recipient rotation, expired ID snapshot, cancel, RPC outage, duplicate click, missing/index-lagged receipt, reload, storage failure and privacy tests all fail safely, without a second transfer or false success.

**M1 — Unified Money and real exchange routes**
- Display Wallet USDC separately from provider-deposited Gateway available/pending balances, never misleadingly combine or double count.
- Prove real Gateway deposit/funding → available ledger balance → payout; add supported funding-source selection in Send/Swap where verified.
- Swap proves exact signed input, any required token approval, quote expiry/min received and real output settlement. Bridge proves original source operation and destination mint/receive, with recovery for stalled routes.
- Keep the same Review → necessary Approve/Sign → Track → Complete/Needs attention experience and owner-scoped history.

**M2 — Social and assisted payments**
- Link and unlink X with real independently verified OAuth to the existing Veyra ID; never create a second account or treat an X handle as wallet ownership.
- Friends, Tip and Chat share that identity, with recipient verification, authorization, privacy and linked verified payment receipts.
- Agent guides the same canonical operation state, rather than embedding competing transaction apps or claiming a payment succeeded.

**M3 — Holistic production hardening and scale**
- Cross-feature/mobile regression, accessibility audit, load tests, performance profiling, monitoring, incident runbooks, backups, recovery drills and rollback rehearsal.
- This phase **extends** quality already required in M0–M2. It does not postpone fundamental security, recovery or usability.

## M0 evidence-based acceptance checklist (single next release target)
1. **A/B identity:** two real team-controlled accounts can register or restore separate signed Veyra IDs; sessions remain wallet-bound after logout, reconnect or device switch.
2. **Recipient and review:** A finds B by ID, verifies B's exact Arc Mainnet wallet and reviews amount, network and fees. **Neither A nor B must first become Friends.**
3. **Small real USDC transfer:** within the explicitly authorized restricted canary, A sends a controlled amount after preflight. Show each required wallet confirmation; do not promise one signature for contract or future Swap/Gateway routes.
4. **Canonical completion:** verify the original hash, correct ERC-20 Transfer event and server-side chain proof; pending/unknown/reverted outcomes cannot be shown as completed or trigger a second send.
5. **Two-sided durable receipt:** A sees Sent, B sees Received, each has scoped access to the same transaction proof; logout and a different device preserve the receipt; B never sees A's private note.
6. **Mobile, resilience, privacy:** practical small-screen completion; stale snapshot, changed wallet, broken network, failed storage, retry, unauthorized API caller and publicly visible explorer data are handled accurately.
7. **Release proof:** record the exact source commit, deployment, original explorer evidence, two wallet/account sessions, test results, known limits and rollback steps. No general-public signing before those conditions pass.

**Success metric:** The *same person-to-person journey works reliably, safely and simply*; number of features, commits and passing tests are supporting signals, not the outcome.

## Engineering release discipline
- Apply security, transaction recovery, mobile ergonomics, accessibility and speed standards **inside each vertical slice**, then run deterministic and fault-injection tests and check the exact release build. Final-phase work covers broad regression and scaling rather than delayed essential quality.
- **Two different Mainnet gates:** (a) a deliberately restricted **team-controlled canary** may allow a small real USDC payment by an explicitly authorized sender wallet, with verified recipient, hard amount cap (currently 0.01 USDC), signed preflight, original-hash journal, monitor/recovery and emergency read-only switch; (b) **general-public Mainnet signing stays NO-GO** until two-account A/B end-to-end proof, compatible rollback and operational acceptance are completed. Do not broaden the canary by merely changing frontend feature flags.
- Stage internal CI/Preview with **no real-money wallet signing on Preview**; run the approved real-wallet canary only on the single official domain under narrowly scoped release controls. CI/Preview establishes code health, **not** monetary settlement.
- Preserve dedicated Mainnet/Testnet databases, transaction records, migration history and secrets; never run destructive database changes or silently turn on new production financial permissions.
- Avoid scattered new tabs or expensive paid infrastructure just to demonstrate a feature. A smaller verified feature beats a broader fake-live feature.
- One release = one versioned commit, test evidence, known limitations, rollback instructions and post-release verification.

## Current evidence and limits (2026-11-02)
- Dedicated Render Mainnet identity/receipt BFF and isolated PostgreSQL exist; startup/migrations and read-only database health were verified through logs and Preview API health.
- Draft PR #91 contains Mainnet identity authority, verified People lookup/Friends, canonical direct USDC Pay proof and scoped two-party receipt history; its browser flow is **not production-accepted**. PRs #87/#90 and the full provider-dependent Swap/Bridge/Gateway/Agent/Chat require separate review and integration.
- Production domain still runs the earlier mainnet deployment. A two-user Veyra-ID-to-USDC-to-two-sided-receipt E2E on that domain is **not verified**.
- This document is a product/acceptance contract, **not a claim that all features have shipped**.

**Completion sentence:** A non-technical user creates one ID, finds a verified person (without having to become Friends), sends USDC, sees independently verified delivery and reopens the same receipt on another device in one seamless Veyra.
