# Veyra X OAuth — Testnet V2 security gate (Phase 14)

## Purpose
X is an **optional linked profile of the existing wallet-signed Veyra ID**.
OAuth never creates a Veyra account, changes the payment recipient,
or authorizes a wallet signature or transfer.

## Required configuration on Render only
- `X_CLIENT_ID`: official X OAuth 2.0 application client ID
- `X_REDIRECT_URI`: exactly `https://veyra-testnet-acceptance-bff.onrender.com/api/auth/x/callback`
- Client secret when applicable: `X_CLIENT_SECRET`, **never** `VITE_*`.
- Configure the exact same callback in the X developer console.
- Render's `VEYRA_APP_ORIGIN` and `VEYRA_TESTNET_ADDITIONAL_ORIGIN`
  must remain the previously approved exact HTTPS origins. Never use `*`.

## Release and acceptance order
1. Merge and migrate the backend schema change adding nullable
   `oauth_link_states.app_origin`; all legacy in-flight states fail closed.
2. Deploy reviewed backend code, with X credentials configured only in Render.
3. Check `POST /api/auth/x/capability` from the approved V2 browser.
   Unless JSON says `{ok:true, available:true}`, Connect X stays disabled.
4. OAuth start requires a valid signed Veyra session. Its random one-use,
   short-lived state and PKCE verifier are held on the server; the exact
   approved browser Origin is stored next to it.
5. X callback exchanges the code on the backend, fetches the immutable X user
   ID and STAGES a short-lived pending profile. It does **not** link on callback.
   Return to the originating host at `/?x_linked=1` (navigation hint only).
6. The initiating browser tab retains the random OAuth state in sessionStorage.
   `POST /api/auth/x/finish` requires that state, a valid signed Veyra ID session
   for the same user, and the same approved Origin. The backend checks the
   pending owner and clears the staged profile after linking.
   Replayed, expired, pasted or cross-wallet callback links are rejected.
   Apply additive migration 0018 before enabling X on Render.
7. Test on two wallets: link once, refresh, reject duplicate cross-ID X
   linking, reject expired/replayed state, disconnect and switch wallet,
   refresh avatar and confirm the original Veyra ID stays unchanged.
8. Keep V2 Testnet main alias unchanged until all gates pass. Do not enable
   Mainnet financial transactions based on an OAuth acceptance result.

## Explicit non-goals
- No X follower scraping or automatic trust of X accounts as payment wallets.
- No client-invented avatars or proof-of-ownership based on a handle alone.
- No unsupported direct messages, fake payment notifications, or Mainnet signer.
- No manual bypass for missing credentials or missing provider callback.

## Rollback
Keep the current stable V2 alias until acceptance. A failed X provider flow
must remain an optional disabled UI feature. Revert the frontend alias if needed;
leave the additive nullable column in the disposable Testnet database.
