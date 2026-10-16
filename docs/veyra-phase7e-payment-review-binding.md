# Phase 7E — Pay by Veyra ID: bind the reviewed recipient

**Scope:** harden an existing server-side identity-and-payments foundation.
No backend has been deployed as a usable public ID payment service and no
financial signing flow is enabled by this change.

## Vulnerability class: recipient substitution inside a legitimate ID

One Veyra ID can own several independently verified wallets, potentially
several on the same chain. The old verification logic accepted *any*
wallet address in a frozen IdentitySnapshot if the chain matched.
It did not authenticate that the sender had originally reviewed that exact
selected wallet address.

A valid reviewed recipient must instead be identified by this tuple:

`authenticated sender user ID + frozen snapshot ID + selected verified
wallet ID + address + exact chain ID + expiry`.

That tuple is signed by the backend with domain-separated HMAC-SHA256, using
an existing server-side secret (minimum 32 characters). A token expires
no later than the frozen snapshot's 30-second review window.

## New flow

1. Authenticated sender prepares `@handle.veyra` recipient on one chain.
2. Backend resolves Veyra ID, enforces blocks, freezes an IdentitySnapshot,
   and chooses only the recipient's valid primary/unique wallet on that chain.
3. Backend returns display information, exact chain/address/wallet ID, and a
   short-lived `reviewToken`. Keep the token in app memory, never log it.
4. Immediately before wallet confirmation, client sends the original
   `snapshotId`, `expectedWalletId`, full `expectedWalletAddress`,
   `expectedChainId` and `reviewToken`.
5. BFF derives sender ID **from its authenticated session**, not a browser
   field. Backend rejects invalid HMAC, wrong sender, swapped wallet,
   cross-chain substitution or expired token *before* checking the snapshot.
6. Existing snapshot verification still rechecks identity revision, active
   wallet set and 30-second expiry. In addition, the wallet selected by the
   frozen receive preference must exactly match all three wallet fields.
7. A separate user-controlled wallet transaction signature remains mandatory.
   A review token is **not** an authorization to move funds.

## Verification

Adversarial Vitest coverage includes:
- valid proof;
- wrong sender, snapshot, address, wallet ID or chain;
- tampered token/signature, wrong HMAC secret, expired/malformed proof;
- substitution with a second legitimately verified same-chain wallet;
- receiving-preference ambiguity, mismatched chain, address;
- BFF session/typed client contract and ordering of security checks.

## Operator gates

- [ ] Authenticated hosted BFF/PostgreSQL must be deployed.
- [ ] Validate these contracts through real HTTP + Postgres acceptance.
- [ ] Prove Testnet Pay by ID with two separate disposable wallet accounts,
  including rejection, refreshed identity revision and receipts.
- [ ] Resolve genuine MetaMask warning on the exact user-facing URL before
  recommending wallet connection.
- [ ] Only then expose Pay by ID as available in public navigation.

**Production and money are unaffected.** This work stays in the Phase 5
Preview branch until existing review gates pass. Earn, Mainnet signing,
Bridge and Swap remain independently disabled.
