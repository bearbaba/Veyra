# Veyra ID — identity, friends and safe payments (Phase 7C foundation)

**Product decision (2026-10-16):** Veyra's identity is its primary product distinction:
**One Identity · Verified Wallets · Friends · Pay by ID**. Messaging and
cross-chain payment routes extend this core later. No rebuild of the approved
Veyra UI and no misleading ready-to-use feature buttons.

## Identity that people can remember

- Public presentation: **@bearcrypto.veyra**. This is a **Veyra application
  alias**, NOT a DNS, ENS or onchain domain name. Never promise ownership of
  a real `.veyra` top-level domain.
- Backend key: immutable `veyraUserId`, e.g. `usr_...`; all relationships,
  proofs and receipts reference this ID, not the changeable handle.
- Canonical DB handle: `bearcrypto`. Continue storing existing normalized
  lowercase ASCII 3–30 character handles; no migration needed for display.
- Legacy `@bearcrypto` and contact nicknames remain readable, but explicit
  `@bearcrypto.veyra` **cannot resolve as an X handle or a contact nickname**.
- Name changes must respect handle history and reservations; friends/payments
  continue to reference immutable `veyraUserId`. Handle ownership verification
  is server-side, never inferred from the appearance of an alias.
- Optional shareable friend code and QR are a **later feature**. A short code
  is an unguessable lookup convenience, NOT a credential, and must be
  database-backed and collision-checked. Six decimal digits are not suitable
  as a primary global identifier.

## Verified wallets, same-chain disambiguation and non-custodial Pay

A single identity may have several verified wallets, including multiple
wallets on the **same network**. Recipient selection MUST:

1. Resolve explicitly named `.veyra` alias to the native Veyra account;
   reject invalid names, X aliases or contact shortcuts for that namespace.
2. Enforce current block/privacy policy, verify wallet bindings and determine
   the selected recipient chain from the **sender's reviewed route**.
3. Respect the recipient's **active primary wallet preference** for that
   chain. If exactly one active verified wallet matches the chain, use it;
   if more than one matches without a valid primary, fail closed with
   `RECIPIENT_WALLET_AMBIGUOUS` rather than choosing the first DB row.
4. Freeze an IdentitySnapshot (30s TTL) of immutable account ID, verified
   address, network and identity revision; show it for user review.
5. Re-verify the snapshot immediately before asking for a separate payment
   signature. Changed/revoked bindings, chain or preference require a fresh
   user review. A friend relation never authorizes wallet signing or assets.

**Scope limit:** These safety checks are in existing server services, but the
shared Vercel Preview does **not** host the Postgres BFF yet. This PR does not
expose a working live `@handle.veyra` sending form, persist new friend codes,
deploy a messaging service, or enable Mainnet payments.

## Human-facing experience (when backend is deployed)

1. Create ID: connect wallet, review handle availability, sign ownership
   challenge, create profile; optional X import with manual overrides.
2. Find friend: search Veyra handle, review avatar + connection state, request
   connection. Search results cannot expose private wallets or balances.
3. Send: choose a friend, specify USDC amount, resolve verified destination,
   review **name + full destination address + network + amount + fees**, then
   explicitly approve with wallet. Show receipt only after chain verification.
4. Chat (future): optional, accessible from the friend's profile, with block,
   report, rate limits, privacy controls and appropriate encryption/key
   recovery. Avoid promises of end-to-end encryption without an audited
   design. No transfer authorization through chat messages.

## Release gates

- [x] Handle parser with strict ASCII lookalike rejection and namespace
      collision prevention.
- [x] Fail-closed selection for multiple verified same-chain wallets.
- [x] Existing signed claim, X OAuth, friendship graph, receiving preferences,
      30-second recipient snapshots already present in repository code.
- [ ] Deploy secured HTTPS BFF and persistent PostgreSQL, run migrations.
- [ ] Browser E2E for signing challenge and authenticated sessions using
      disposable **Testnet wallets**; protect replay, CSRF, spam and sessions.
- [ ] Test friends' request/accept/reject/block policy with a real database.
- [ ] Test real Pay-by-ID on Arc Testnet with sender/recipient account changes,
      wrong network, wallet rejection, page refresh and receipt recovery.
- [ ] Build and security-review backend-backed Friend Code and QR lookup.
- [ ] Only then expose Identity, Friends and Pay-by-ID in stable public UI.
- [ ] Resolve the actual MetaMask flagged URL through its official review
      process before recommending wallet connection to users.

## Current product rollout boundary

Production at Vercel `develop` is unchanged. PR #7 is still the larger
Phase 5 → Production promotion and requires independent user/wallet/browser
acceptance. Mainnet remains **read-only**, and Earn/Swap/Bridge execution
is deferred behind individual release gates. No money or private keys are
needed for this Phase 7C foundation.
