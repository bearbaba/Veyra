# Phase 25 — Preview origin denial and honest Bridge readiness

Observed in user screenshots on 27 October 2026:
- The wallet is connected (`0x4C7c…8Dcb`), but Veyra ID, Friends, X and Bridge are blocked on the same deployment.
- The signed-origin probe returned `403 ORIGIN_NOT_ALLOWED`. This is **correct** rejection of a hashed Preview hostname that does not match Render's exact `VEYRA_APP_ORIGIN` / `VEYRA_TESTNET_ADDITIONAL_ORIGIN`.
- Vercel's stable domain `https://veyra-unified-testnet-v2.vercel.app` exists, but its assigned deployment at review was `90b1065` (a separate, older release) rather than the latest Phase 24 Preview `32b3616`.
- Render's hosted `veyra-testnet-acceptance-bff` service is **not** on PR #82. It has auto-deploy OFF, runs the `phase5-production-bridge-flow` release at `0c696c7`, and currently cannot be assumed compatible with all Phase 14–24 frontend features. Its allowlist permits exactly one primary and one additional origin, no wildcard/list.

Code changes:
- When identity origin is not authorized, Bridge makes its destination/amount form viewable but **disables the Review CTA** immediately with a plain-English reason; the form does not silently reset fields.
- A trusted origin without a signed session shows the **existing** VeyraIdentityAccess prompt inline. No second wallet picker, no automatic signature.
- Destination change invalidates any prior Bridge state. Bad wallets/amounts disable Review. Existing CCTP burn replay guard/recovery and on-chain simulation rules remain intact.
- Identity access shows an optional link to the *stable*, different-version Testnet deployment. It opens a new tab; no assumption is made about authentication readiness or carrying an old draft across origins. Technical 403 is under a disclosure, not the primary user message.
- Regression checks prove exact hosted-origin enforcement remains fail-closed.

**NOT an origin unblock or financial acceptance.** No production alias, Render env, Render schema, X OAuth credentials or domain policy was modified.

Real unblock release order:
1. Choose a stable, reviewed Testnet V2 deployment with matching backend source/migrations, and verify no conflict with primary/additional accepted origins.
2. Confirm the Render workspace and release scope; run staged migrations and deploy matching guarded backend (not the currently pinned older BFF) before assigning the stable V2 alias.
3. Verify the signed origin probe returns `400 INVALID_REQUEST` for intentionally unsigned payload; sign in by real wallet, refresh, switch wallet, exercise Friends/X, test a small direct Pay and complete Bridge source→attestation→destination with evidence. Do not auto retry pending wallet prompts.
