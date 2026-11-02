# Veyra — Product Standard & End-to-End Acceptance
Version: 1.0 · 2026-11-02 · Product owner direction

## North star
Veyra is **a human-first USDC payments app**, not a blockchain dashboard. Someone unfamiliar with chains, transaction hashes, signatures and bridges should still be able to find a person, review a payment, sign once in their wallet and revisit an authentic receipt.

**One canonical user-facing web app:** https://veyra-seven-beta.vercel.app/. Internal API services and previews are not separate wallet-connect websites. **Default language: English.** Vietnamese is an optional locale. Desktop and mobile must support the same essential actions.

## Hard product invariants
1. **One identity:** One active Veyra account/ID maps to verified wallet bindings and, when available, an independently OAuth-verified X account. Veyra ID is used consistently by Friends, Pay, Tip and Chat. X is not a substitute for wallet ownership. Never silently create a second ID or trust an arbitrary X handle as an account claim. Wallet rotation and disconnect must invalidate stale payment authority.
2. **One payment journey:** People → identify recipient → enter USDC amount → Review (person, actual receiving wallet, network, amount, fees, available funding source) → explicit wallet authorization → Track original transaction → Completed only after independent proof → shared-view two-sided receipt. Regular users never need to paste a transaction hash. Hash recovery can be tucked under Advanced.
3. **Two distinct sources of funds:** *Wallet USDC* is directly owned by the connected wallet; *Unified Gateway balance* is an independently funded/deposited provider balance, not another wallet balance and not automatically spendable. Show available/pending amounts separately. Select a valid source within Send/Swap/Bridge where the relevant provider supports it. Never add funds twice into one misleading total.
4. **No phantom completion:** A wallet popup, provider quote, pending hash, or frontend 200 is not a verified transfer. Use explicit stages: Review → Sign → Track → Complete / Failed / Needs attention. Each screen (Home, People, Chat, Agent, Activity) reads the same durable operation/receipt identity rather than inventing local success.
5. **No duplicate financial action:** Persist intent before signing; correlate chainId, owner, recipient, token, amount, provider and original hash or provider order ID. On timeout, reload or lost connection, reconcile the *original* action before offering another. Never auto-sign, auto-send or silently reroute to a new receiving wallet.
6. **Privacy:** A payment appears only to authorized sender and recipient. Sender-private notes must not reach recipients. Chat, contact lists, X connection metadata and receipt history are scoped to authenticated users. All writable APIs enforce server-side ownership; avoid exposing public transaction feeds as a user's private activity.
7. **Trust and clarity:** Every balance and transaction cites its source, last-updated state and network where relevant. Network, fees, slippage, expiration, min received, risk and recovery must be visible before signing. Explicitly distinguish contract payment from escrow and avoid guarantee/refund language unless actually implemented.
8. **Graceful feature gates:** Unverified Mainnet providers, X OAuth, Swap, Bridge, Gateway, Agent and Chat must show an honest unavailable explanation; they cannot masquerade as live or redirect wallet connection to a Preview/Testnet application.

## Navigation, responsibilities, information hierarchy
| Area | Job for the user | Primary content |
|---|---|---|
| Home | Know what money I can use and what needs attention | Wallet balance; separated Gateway available/pending; Send/Receive; most recent original operations |
| People | Find, trust, pay, tip or chat with a person | Veyra ID, verified wallet, Friend state, clear action buttons |
| Pay / Send | Move USDC to a verified person or explicit wallet | Source selector when supported, amount, review, sign, original receipt |
| Swap | Exchange supported assets | Real quote and provider, gas/fees, slippage/min receive/expiry, approve/sign, actual output evidence |
| Bridge | Move between supported chains | Origin/destination, actual provider quote, fees/minimum, source burn/lock and destination mint/receive proof |
| Gateway / Unified | Deposit and distribute supported USDC funding | Provider-funded balance, supported routes, available vs pending, ledger/recovery |
| Chat | Communicate with trusted person | Conversation tied to the same Veyra ID; payments link to canonical receipt |
| Agent | Assist, never fabricate a transaction | A concise guided review/sign/track flow; no duplicate embedded Bridge app |
| Activity | Reopen everything safely | Persistent sender/recipient history with statuses, original hashes and explorer evidence |

## Acceptance definition (real devices, two user-owned wallets, one official website)
**P0 — First complete human payment**
- A registers or restores Veyra ID with wallet A; B separately registers or restores with wallet B on the same exact environment. Logout/reload restores only the rightful session.
- A finds B using `@handle.veyra`, sees current independently verified recipient, invites B; B accepts. Unverified local contacts never appear as certified Veyra users.
- A enters a small USDC amount, reviews the *exact* recipient, amount, token, correct chain and fee, confirms a single wallet request. B can receive without visiting another website.
- Veyra automatically follows the original transaction; both A and B see the same canonical chain proof in their respective authenticated histories (sent/received) across two devices. An unverifiable transfer remains pending/unknown, never success. An optional private sender note is invisible to B.
- Wallet rotation, expired recipient snapshot, cancelled signature, RPC timeout, storage errors, duplicate click, conflicting receipts and concurrent indexing all fail safely without a duplicate payment.
- Mobile and desktop: one obvious next action, no extra blockchain settings needed.

**P1 — Unified identity and messaging**
- OAuth-linked X account is genuinely bound to exactly the verified Veyra identity according to an explicit account-link/recovery policy; linking/disconnecting X never silently changes the wallet or creates an alternate account.
- Friends, Tip and Chat use that same account, with explicit privacy, permissions and historical payment linking.

**P2 — Complete funds and exchange lifecycle**
- Gateway proves funding/deposit → available ledger balance → route or payout completion; no blending with wallet USDC.
- Swap proves signed input and actual output amount on the target chain; min receive and quote expiry enforced.
- Bridge proves exact source transaction plus destination mint/receive; bidirectional only for independently supported routes. On stalled provider execution, Track/Recover preserves original intent.
- Home, Activity and Agent show the identical operation status sourced from a single durable operation model; mobile navigation stays minimal.

## Engineering release discipline
- Finish a coherent vertical slice, run deterministic tests + security/failure tests, then check same-version Preview and finally real-wallet acceptance on the single official Production domain under explicit safety restrictions.
- Mainnet signing is **NO-GO** until real-wallet acceptance and a compatible rollback/recovery design pass. Internal CI/Preview is proof of code health, **not** proof of monetary settlement.
- Preserve dedicated Mainnet/Testnet databases, transaction records, migration history and secrets; never run destructive database changes or silently turn on new production financial permissions.
- Avoid scattered new tabs or expensive paid infrastructure just to demonstrate a feature. A smaller verified feature beats a broader fake-live feature.
- One release = one versioned commit, test evidence, known limitations, rollback instructions and post-release verification.

## Current evidence and limits (2026-11-02)
- Dedicated Render Mainnet identity/receipt BFF and isolated PostgreSQL exist; startup/migrations and read-only database health were verified through logs and Preview API health.
- Draft PR #91 contains Mainnet identity authority, verified People lookup/Friends, canonical direct USDC Pay proof and scoped two-party receipt history; its browser flow is **not production-accepted**. PRs #87/#90 and the full provider-dependent Swap/Bridge/Gateway/Agent/Chat require separate review and integration.
- Production domain still runs the earlier mainnet deployment. A two-user Veyra-ID-to-USDC-to-two-sided-receipt E2E on that domain is **not verified**.
- This document is a product/acceptance contract, **not a claim that all features have shipped**.

**Completion sentence:** A non-technical user creates one ID, finds a friend, sends USDC, sees independently verified delivery and reopens the same receipt later in one seamless Veyra.
