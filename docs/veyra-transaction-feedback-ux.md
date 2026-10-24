# Veyra · Transaction feedback and UX release contract

**Goal:** One clean action, immediate honest feedback, no mystery spinner, and a reviewable receipt beside the progress on desktop (stacked on mobile).

### Arc Testnet Pay state machine

- **PREPARING:** deterministic recipient snapshot, chain, simulation, risk and policy checks before requesting a wallet signature.
- **SIGNING:** explicit approval from the wallet. A spinner never means the transaction is on-chain.
- **CONFIRMING:** the wallet returned an actual transaction hash. Persist `PENDING` locally immediately and display its Arc explorer link.
- **VERIFYING:** receipt obtained, but independently verified ERC-20 transfer events and recipient balance evidence are still being checked.
- **DONE:** show **Verified** only when the reviewed amount, recipient, token and on-chain evidence match.
- **FAILED:** before submission failed safely, or receipt proved the transaction reverted. Only confirmed reverts may be described as *on-chain failures*.
- **CANCELLED:** wallet RPC specifically returned rejection code 4001 and no hash is known.
- **PENDING:** an on-chain hash is not yet verified, OR wallet submission result is unknown. **Do not suggest retrying payments.** Preserve the transaction hash and show status clearly.

### UX acceptance criteria

1. Show a live spinner with a readable state label; no empty loading screen or lost wallet responses.
2. On desktop place a detailed status panel alongside receipt/progress. On mobile stack vertically without overflowing.
3. Include amount, asset, network, sender, recipient and hash when known. Show an explorer link only with a real hash.
4. Keep **green success** exclusive to verified chain state; errors do not imply funds failed to move.
5. Store pending receipts before confirmation; show unresolved transactions in Activity, with conservative language.
6. Users should not need to re-connect or re-register their Veyra ID when switching internal tabs.
7. Screen reader announcements use `role=status` and `aria-live=polite`.
8. Do not turn unverified financial, bridge or incoming-payment events into a successful notification.
9. While the payment result remains unknown, direct users to review Activity or the explorer; never automatically re-broadcast.
10. Global notifications and chat will require authenticated owner scope and verified proof; this UI change does **not** claim that background pushes, WebSocket updates, message encryption or incoming payment indexing have shipped.

**Current scope:** local in-app transfer progress and a persisted receipt cache. It does not replace a server-indexed transaction recovery service, phone push alerts, long-running background polling, independent live-wallet testing or a Mainnet security release gate.
