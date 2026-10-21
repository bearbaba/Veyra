## What changed?

<!-- Describe one concrete improvement. Link issue / design / source evidence. -->

## Why is it useful for Veyra users?

<!-- Identity/Friends/Pay, honest Unified balances, accessibility, safety, etc. -->

## Scope and release boundary

- [ ] Testnet is the default and remains the only approved wallet-signing UI.
- [ ] Mainnet financial execution remains disabled; no signer/provider promotion.
- [ ] Existing Veyra design remains consistent; UI text is clear, English by default.
- [ ] No fake balances, quotes, yields, receipts, messages or claims of live services.
- [ ] No private keys, secrets, tokens, user data or new unreviewed RPC endpoints.
- [ ] No automatic migration, chargeable infrastructure or Production promotion.

**Target branch:** <!-- e.g. phase5-production-bridge-flow; develop needs independent release approval -->

**Newly enabled money movement (if any):** <!-- normally: None -->

## Verification evidence

- [ ] `bun run typecheck`
- [ ] `bun run lint`
- [ ] `bun run test`
- [ ] `bun run check:repository-trust`
- [ ] Relevant negative/adversarial regression tests added
- [ ] Preview/mainnet bundle isolation and browser CI green where relevant
- [ ] Hosted DB / real Testnet acceptance clearly distinguished from mocked tests
- [ ] README / SECURITY / CHANGELOG and linked history updated as appropriate

**CI run URL and exact commit:** <!-- not just "green" -->

**Real wallet-signed acceptance:** <!-- not applicable / pending / exact sanitized Testnet evidence -->

## Failure cases and rollback

**What might fail?** <!-- wrong chain, recipient mismatch, stale session, RPC 429, reload, duplicate tx -->

**How does it fail closed?**

**Rollback plan and reviewer/operator sign-off required:**

<!-- For a vulnerability, report privately per SECURITY.md. Do not paste exploits into PRs. -->
