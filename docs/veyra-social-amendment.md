# Veyra Architecture Amendment — Social Identity Layer
# Status: APPROVED — incorporated into v1.0 spec
# Date: 2026-10-08

---

## Overview

This amendment expands the Veyra product equation from:

  Identity + Intent + Routing

to:

  Identity + Social + Payments + Agent + Routing

Every module defined in `veyra-architecture-v2.md` remains authoritative. This document extends it.
No existing architectural decisions are reversed. Where this document conflicts with v2, this document wins.

---

## 1. Native Veyra Identity

### 1.1 Primary key: veyraUserId

`veyraUserId` is the single canonical key for every Veyra entity. It is:

- Generated once at account creation.
- Immutable for the lifetime of the account.
- Never derived from or dependent on any external identity (X, ENS, wallet address).
- Format: `usr_<32-char base58>` — e.g. `usr_8f31kQmzN4rPxVwBcD7hJY2sTgL9Ae0`.

All wallets, linked social accounts, social relationships, receiving preferences, Agent permissions,
and ActivityReceipts attach to `veyraUserId`. Nothing else is used as a join key across tables.

### 1.2 veyraHandle

`veyraHandle` is the human-readable public identifier. Properties:

- Unique across all active accounts (case-insensitive, normalized to lowercase at storage).
- Display format with `@` prefix: `@bearcrypto`.
- **Mutable** under controlled rules:
  - One change per 30-day rolling window.
  - Previous handles held in a `handle_history` table, reserved for 90 days.
  - Handle changes do not affect wallet bindings, proofs, or identity revision.
- Handle claims are soft-deleted (reservation window) before release.
- Must never be used as a database foreign key — always join on `veyraUserId`.

### 1.3 Profile fields

| Field              | Mutable | Source      | Notes                                        |
|--------------------|---------|-------------|----------------------------------------------|
| `veyraUserId`      | No      | System      | Primary key                                  |
| `veyraHandle`      | Yes*    | User        | *controlled rules above                      |
| `displayName`      | Yes     | User/X      | User override wins over imported X name      |
| `avatarUrl`        | Yes     | User/X      | CDN URL; user-uploaded or imported from X    |
| `bio`              | Yes     | User/X      | User override wins                           |
| `profileVisibility`| Yes     | User        | `PUBLIC | FOLLOWERS_ONLY | PRIVATE`          |
| `createdAt`        | No      | System      |                                              |
| `updatedAt`        | Yes     | System      |                                              |
| `status`           | System  | System      | `ACTIVE | SUSPENDED | DELETED`               |

### 1.4 Profile visibility

`profileVisibility` controls what is visible to unauthenticated viewers and non-followers:

- `PUBLIC`: handle, displayName, avatar, bio, follower/following counts, receive asset hint.
- `FOLLOWERS_ONLY`: same as PUBLIC but only followers see the profile body.
- `PRIVATE`: only the user and approved friends see the profile.

Financial data (balances, transaction history, wallet addresses) is **private by default**
regardless of `profileVisibility`. See Section 10 (Privacy).

---

## 2. X-Linked Profile

### 2.1 Binding

X account linkage is optional. A Veyra user may link at most one X account at a time.

Linkage flow:
1. OAuth 2.0 authorization to Veyra backend. The backend receives `xAccessToken` (server-only, never client).
2. Backend reads `xAccountId` (numeric, permanent), `xHandle`, `xDisplayName`, `xAvatarUrl`, `xBio`.
3. Stores `xAccountId` as the immutable binding key in `linked_identities`.
4. All mutable X presentation fields stored as refreshable metadata.

### 2.2 What X linkage does and does not do

**Does:**
- Enables `@xHandle` as a recipient resolution alias in `VeyraIdentityResolver`.
- Imports presentation metadata (avatar, display name, bio) as defaults the user may override.
- Allows other Veyra users to find/follow by X handle.

**Does not:**
- Replace `veyraUserId` as the canonical key.
- Carry any wallet authority. Changing or revoking an X account never invalidates wallet proofs.
- Make `xHandle` a stable lookup key — it is always translated to `veyraUserId` before any operation.

### 2.3 Profile customization choice

The user may:
- **Use X profile**: display name, avatar, bio mirror X; auto-updated on X import refresh.
- **Customize Veyra profile**: user-set fields override X imports; X re-import does not overwrite.

The choice is stored per-field via `profileSourceOverride` flags. A revoked X token reverts all
X-sourced fields to blank, never to a previous user override.

---

## 3. Social Graph

### 3.1 Concepts

Two separate relationship concepts, deliberately kept separate:

**Follow** (asymmetric):
- User A follows User B. B does not necessarily follow A.
- Grants A visibility into B's public activity feed (future).
- Grants zero financial permissions.
- B may block A, which prevents following and hides profile.

**Connection / Friendship** (symmetric, opted-in):
- User A sends a friend request to User B. B accepts or rejects.
- Creates a mutual `CONNECTED` edge.
- Enables richer Send/Request flows (name resolution, receive preference display).
- Connection does NOT grant financial permissions. Payment always requires explicit review.

### 3.2 States

Follow states: `FOLLOWING | UNFOLLOWED (soft-deleted)`
Connection states: `PENDING_A_TO_B | PENDING_B_TO_A | CONNECTED | REJECTED | DISCONNECTED`
Block states: `BLOCKED` (directional — A blocks B; B may not see A, follow A, or send to A)

### 3.3 Constraints

- A block always wins over follow/connection state. A blocked user cannot send payments to the blocker.
- Follow and friendship are evaluated separately — a follow must never be promoted to friendship implicitly.
- Agent commands that reference "my friends" or "people I follow" must query the graph through
  `SocialGraph`, never by scanning wallet addresses.

---

## 4. Payment Recipient Resolution

### 4.1 Resolution hierarchy

`VeyraIdentityResolver.resolveRecipient(input)` accepts:

1. `@veyraHandle` — normalized to `veyraUserId` via handle table.
2. `@xHandle` — resolved via `linked_identities.xHandle → veyraUserId`.
3. Explicit wallet address `0x...` — resolved as anonymous recipient with no Veyra profile.
4. QR code — decoded to one of the above.

### 4.2 IdentitySnapshot freeze

Before presenting a payment review screen, `VeyraIdentityResolver.freezeSnapshot(veyraUserId)`
is called. The snapshot records:

```typescript
interface IdentitySnapshot {
  snapshotId:          string;          // uuid
  veyraUserId:         string;          // immutable
  veyraHandle:         string;          // as of snapshot time
  displayName:         string;
  avatarUrl:           string;
  resolvedWallets:     WalletEntry[];   // verified wallets at snapshot time
  receivePreference:   ReceivePreference;
  identityRevision:    number;          // from veyra_users.identity_revision
  frozenAt:            string;          // ISO-8601
  expiresAt:           string;          // frozenAt + 30s
}
```

Immediately before the user confirms the transaction, `verifySnapshot(snapshot)` re-reads
`identity_revision` from the database. If it has changed, the review is invalidated with
`HARD_BLOCK: IDENTITY_CHANGED_SINCE_REVIEW`. The user must re-initiate the Send flow.

`identity_revision` is incremented on: wallet add/remove/revoke, receive preference change,
linked identity add/remove, account suspension.

---

## 5. Recipient Preferences

```typescript
interface ReceivePreference {
  veyraUserId:          string;
  preferredToken:       TokenId;          // e.g. 'usdc'
  preferredChainId:     number;           // e.g. 5042002 (Arc Testnet)
  primaryWalletId:      string;           // FK → wallet_bindings
  alternativeRoutes:    AlternativeRoute[];
  visibility:           'PUBLIC' | 'FRIENDS_ONLY' | 'PRIVATE';
  updatedAt:            string;
}

interface AlternativeRoute {
  chainId:   number;
  token:     TokenId;
  walletId:  string;
  priority:  number;   // lower = higher preference
}
```

Rules:
- Preferences are hints. `SendSuggestionEngine` reads them but is not bound by them.
- If the sender's balance/route cannot satisfy the preference, the engine proposes the next-best
  route and displays a clear explanation.
- `PREFERENCE_UNSATISFIABLE` is a WARNING (not a HARD_BLOCK).
- Preference `visibility: PRIVATE` hides preferred chain/token from the payment review screen
  for non-friends (the engine still uses them internally if the sender is a friend or the
  recipient has chosen `FRIENDS_ONLY`).

---

## 6. SendSuggestionEngine

### 6.1 Purpose

Shared between Payment UI, Agent pipeline, and any future surface. Never reimplemented per feature.

### 6.2 Inputs

```typescript
interface SuggestionRequest {
  senderVeyraUserId:    string;
  recipientSnapshot:    IdentitySnapshot;
  amount:               Amount;
  assetId:              string;           // what the sender wants to send
  senderBalances:       ChainBalance[];
  availableRoutes:      ScoredRoute[];    // from RouteEngine
  timestamp:            string;
}
```

### 6.3 Ranking dimensions

Each candidate route is scored on:

| Dimension              | Weight | Notes                                          |
|------------------------|--------|------------------------------------------------|
| Recipient preference   | High   | Exact chain+token match scores highest         |
| Same-chain avoidance   | High   | Penalise bridge when same-chain is available   |
| Fee (absolute)         | Medium | Lower is better                                |
| Estimated arrival      | Medium | Faster is better; CCTP ~20min vs same-chain ~5s|
| Provider health        | Medium | Degraded providers penalised                   |
| Amount received        | Medium | After fees — receiver gets more = better       |
| Route lifecycle stage  | Hard   | Routes not in ENABLED state are excluded       |

### 6.4 Output tiers

```typescript
interface SuggestionResult {
  recommended:   RankedRoute;      // system best overall
  cheapest:      RankedRoute;      // lowest fee
  fastest:       RankedRoute;      // lowest estimated arrival
  sameChain:     RankedRoute | null;  // null if no same-chain route exists
  allRoutes:     RankedRoute[];    // full ranked list, ENABLED only
}
```

### 6.5 Agent integration

When an Agent command says "send 5 USDC to @alice", the pipeline:

1. Resolves `@alice` → `IdentitySnapshot`.
2. Calls `SendSuggestionEngine.suggest(request)`.
3. Presents `recommended` route to the user for confirmation.
4. User may switch to `fastest` or `cheapest` — Agent must not auto-select non-recommended.
5. User signs. `TransactionPolicy` runs its full check. Execution proceeds.

Post resolution path: `post → author → veyraUserId → IdentitySnapshot → receivePreference → route → review → confirm`.

---

## 7. Social Profile (UI contract)

Profile screen must surface:

| Element                       | Visibility rule                              |
|-------------------------------|----------------------------------------------|
| Avatar                        | Per profileVisibility                        |
| Display name                  | Per profileVisibility                        |
| @veyraHandle                  | Per profileVisibility                        |
| Linked @xHandle               | Per profileVisibility + user choice          |
| Verification badge            | Public always                                |
| Bio                           | Per profileVisibility                        |
| Follower / following counts   | Per profileVisibility                        |
| Preferred receive asset/chain | Per preference.visibility                    |
| Send button                   | Always shown (disabled if blocked)           |
| Request button                | Always shown (disabled if blocked)           |
| Follow / Add Friend buttons   | Per block state                              |
| Wallet address                | NEVER shown on profile; shown only in review |

Shortened wallet (`0x1234…abcd`) shown only on the payment review confirmation screen,
never on the profile page.

---

## 8. Posts and Interactions — Data Model Only

The following tables must exist in Phase 1 schema but no application code writes to or reads
from them in Phase 1. They are schema-forward declarations to avoid identity redesign later.

Tables (schema only, not wired):

- `posts` — `postId`, `authorVeyraUserId`, `content`, `mediaUrls[]`, `visibility`,
  `createdAt`, `updatedAt`, `deletedAt`
- `post_interactions` — `interactionId`, `postId`, `actorVeyraUserId`, `type`
  (`LIKE | REPLY | REPOST | TIP`), `createdAt`
- `post_tips` — `tipId`, `postId`, `executionReceiptId` (FK → activity_receipts),
  `senderVeyraUserId`, `amount`, `assetId`, `chainId`, `createdAt`

Agent resolution path (future):
`"tip the author of this post"` →
`posts.postId → posts.authorVeyraUserId → VeyraIdentityResolver.freezeSnapshot()`
→ `SendSuggestionEngine → TransactionPolicy → confirm`

---

## 9. Social Payments — Future-Compatible Actions

All of the following must be expressible by the existing action schema with zero schema changes:

| Action       | Resolved via                          | Execution path          |
|--------------|---------------------------------------|-------------------------|
| Send         | Recipient resolution + suggestion     | Payment pipeline        |
| Request      | Recipient resolution                  | Request receipt (no TX) |
| Tip (user)   | Profile → IdentitySnapshot            | Payment pipeline        |
| Tip (post)   | Post → authorVeyraUserId → snapshot   | Payment pipeline        |
| Pay from QR  | QR decode → recipient resolution      | Payment pipeline        |

All paths converge at `IdentitySnapshot` + `TransactionPolicy` before any signing.

---

## 10. Privacy Rules

These are hard architectural rules, not configuration:

1. **Transaction history is private by default.** No recipient's transaction history
   is exposed via any API unless they have explicitly opted in to public activity.
2. **Balance is never transmitted.** The BFF never returns another user's balance
   to any client.
3. **Wallet addresses are not profile data.** Wallet addresses are stored internally
   but never served in profile API responses. They appear only in the payment review
   payload after the sender initiates a transfer.
4. **Social visibility ≠ financial permission.** A `profileVisibility: PUBLIC` user
   does not grant anyone permission to execute payments. Every payment requires the
   sender's explicit wallet signature.
5. **Block always wins.** A blocked user cannot initiate a payment to the blocker,
   resolve the blocker's identity for payment purposes, or view the blocker's
   receive preferences.
6. **Financial and social policy are separate.** `TransactionPolicy` and `SocialGraph`
   are never co-mingled. Social connections are inputs to `SendSuggestionEngine` only;
   they never bypass or relax `TransactionPolicy` checks.

---

## 11. New Shared Modules

These are added to the authoritative module list alongside the six from v2:

| Module                  | Responsibility                                                        |
|-------------------------|-----------------------------------------------------------------------|
| `ProfileService`        | CRUD for veyra_users, handle claims, profile visibility, X import    |
| `SocialGraph`           | Follow/unfollow, friend request lifecycle, block, relationship query  |
| `ContactGraph`          | Addressbook overlay — label a contact, set trusted status, hide      |
| `RecipientPreference`   | Store/read/update receive preferences; enforce visibility             |
| `SendSuggestionEngine`  | Rank routes given sender balances, recipient prefs, provider health   |
| `PostService`           | Future — post CRUD, interaction events, tip linkage (schema-ready)   |

Integration with v2 modules:

```
User input (@handle / @xHandle / address / QR)
  └→ VeyraIdentityResolver
       └→ SocialGraph (block check)
       └→ ProfileService (snapshot)
       └→ RecipientPreference
            └→ SendSuggestionEngine
                 ├→ ChainRegistry
                 ├→ TokenRegistry
                 ├→ RouteEngine  (BridgeProviderAdapter × N)
                 └→ TransactionPolicy
                      └→ ActivityReceipt (append-only log)
```

---

## 12. Module Invariants

These invariants must be enforced at the module boundary, tested, and never relaxed:

1. `veyraUserId` is the only permitted FK across all tables. `veyraHandle` and `xAccountId`
   are lookup aliases, never join keys.
2. `IdentitySnapshot.identityRevision` must be verified immediately before confirm.
   Stale snapshot → `HARD_BLOCK: IDENTITY_CHANGED_SINCE_REVIEW`.
3. A payment cannot proceed if the recipient is in `BLOCKED` state relative to the sender.
4. `SendSuggestionEngine` must be called identically by Payment UI and Agent pipeline.
   No surface may have its own routing logic.
5. `PostService` tables exist in Phase 1 schema. No application code references them
   until a Post feature phase is explicitly approved.
6. `profileVisibility` never controls financial data visibility. Financial privacy rules
   (Section 10) are absolute and unconditional.
7. A `veyraHandle` change must increment `identity_revision`.
8. A linked X account revocation must increment `identity_revision`.

---

## Amended Implementation Phases

Phases from `veyra-architecture-v2.md` are updated as follows. Phase numbering is preserved;
Phase 1 scope is expanded; a new Phase 0 is inserted.

### Phase 0 — Design review gate (THIS DOCUMENT)
- All schema tables reviewed and approved before any migration is written.
- Output: `docs/veyra-phase1-schema.md` — full table definitions, indexes, FK constraints,
  migration plan. Reviewed before Phase 1 begins.

### Phase 1 — Storage Foundation (expanded)
Now includes all social schema tables in addition to the v2 tables.
Full table list: see `docs/veyra-phase1-schema.md`.
No application logic reads or writes social tables except `ProfileService.createUser`.

### Phase 2 — VeyraIdentityResolver + ProfileService
Includes: Veyra user creation, handle claim, EIP-712 wallet proof, identity snapshot,
X account linking, profile update, `identity_revision` increment triggers.

### Phase 3 — ChainRegistry + TokenRegistry (unchanged)

### Phase 4 — SocialGraph + ContactGraph
Includes: follow, connection request lifecycle, block. No payments yet.

### Phase 5 — RouteEngine + BridgeProviderAdapter (unchanged)

### Phase 6 — SendSuggestionEngine + TransactionPolicy + preflight
Includes: suggestion ranking, recipient preference integration, duplicate-send guard.

### Phase 7 — Production Payment UX
Pay / Agent / Bridge surfaces consuming shared modules.
DEV E2E tooling fully isolated. CctpE2EPage behind `VITE_DEV_TOOLS` guard.

### Phase 8 — KMS Relayer + Live X Identity + Social Profile UX
Production relayer, HSM signer, X OAuth import, full profile screen, Send from profile,
follow/friend actions.

### Phase 9 — Posts + Feed (future, gated)
Schema-ready from Phase 1. Not approved for implementation until separately reviewed.
