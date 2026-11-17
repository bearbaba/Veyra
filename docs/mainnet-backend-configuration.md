# Mainnet backend configuration

Service: Render `veyra-mainnet-v1-bff` (container built from `Dockerfile.bff.mainnet`).
Frontend: the existing Vercel project. Its build profile is fixed in
`scripts/build-mainnet-pilot.ts`, so the frontend needs no `VITE_*` variables in
the Vercel dashboard.

Set secrets in the Render service's Environment settings. Never commit values,
paste them into chat, or prefix them with `VITE_`.

## Observed state

Read from the live service on 2026-11-07. Re-check with `GET /api/health` and
`GET /api/health/capabilities`.

| Capability | Reported state | What it means |
| --- | --- | --- |
| Database | reachable | PostgreSQL connection works. |
| Identity | available | Wallet-signed Veyra ID works. |
| Chat | available, encryption key present | Messages are encrypted at rest on the server. This is not end-to-end encryption. |
| Payment requests, pay-journal sync, settlement receipts | available | Receipt indexing works. |
| X linking | not available | OAuth client ID, secret and exact callback are not configured. |
| LLM provider | none | No language-model key is configured. |
| Settlement V2 | not available (`OWNER_REVIEW_AND_DEPLOY_REQUIRED`) | Out of scope; V1 is unchanged. |

## Important: identity-only mode

When `VEYRA_MAINNET_IDENTITY_ONLY=1`, the backend answers only a reviewed list
of identity and receipt routes (`server/services/mainnetIdentityOnlyRoutes.ts`,
`isMainnetIdentityOnlyRouteAllowed`). Every other `/api` route returns
`503 MAINNET_V1_ROUTE_NOT_ENABLED`. This is intentional: X, Agent and server-side
financial routes are blocked by design on Mainnet.

Setting the variables below is therefore not enough on its own to enable X
linking or Agent. Each also needs a reviewed allowlist change and a deploy. The
frontend shows both as unavailable until then and does not simulate them.

## Variables

Names only. Values belong in Render.

| Variable | Purpose | Needed for |
| --- | --- | --- |
| `VEYRA_ENV` | Must be `mainnet`. | Required (set) |
| `DATABASE_URL` | PostgreSQL connection string. | Required (set) |
| `VEYRA_SESSION_SECRET` | Signs identity sessions. | Required (set) |
| `VEYRA_APP_ORIGIN` | Exact allowed browser origin: `https://veyra-seven-beta.vercel.app`. | Required (set) |
| `VEYRA_CHAT_ENCRYPTION_KEY` | Encrypts stored chat messages. | Chat (set) |
| `VEYRA_MAINNET_IDENTITY_ONLY` | `1` restricts the API to identity and receipts. | Keep `1` until a route review says otherwise |
| `X_CLIENT_ID` | X OAuth client ID. | X linking |
| `X_CLIENT_SECRET` | X OAuth client secret. | X linking |
| `X_REDIRECT_URI` | Exactly `https://veyra-mainnet-v1-bff.onrender.com/api/auth/x/callback`, and the same URL registered in the X developer portal. | X linking |
| `X_BEARER_TOKEN` | Read-only X handle lookup. | X linking (lookup) |
| `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | Language-model provider for Agent. If both are set, OpenAI is used. | Agent |
| `LLM_MODEL` | Optional model override. | Agent |
| `CIRCLE_API_KEY` | Server-side Circle API access. | Server-side Circle calls only |

## Circle Gateway on Mainnet

Mainnet Gateway balances and deposits run in the browser through the Circle
App Kit and the user's wallet. The backend's Gateway routes
(`/api/gateway/*`) are Testnet-only and return `GATEWAY_TESTNET_ONLY` on
Mainnet. A `circleApiConfigured: false` flag in `/api/health` therefore does not
by itself show that Mainnet Gateway is broken; it must be checked in the
product with a real wallet.

## Database changes

No migration is part of this configuration. Before any production migration:
verify a restorable backup (`VEYRA_MAINNET_BACKUP_*`), test compatibility on a
restored copy, and write down the rollback step. Do not run destructive
statements.

## Verifying the frontend release

`GET https://veyra-seven-beta.vercel.app/veyra-build.json` returns
`{"env":"mainnet","sha":"<full commit>","vercelEnv":"production"}`. The SHA must
equal the commit that was merged. The build fails if the compiled bundle does
not carry the Mainnet stamp.
