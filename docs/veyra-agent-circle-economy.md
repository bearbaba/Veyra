# Veyra Agent Economy — Circle integration (discovery phase)

**State:** Read-only discovery implemented on a feature branch. No agent wallet, delegated execution or x402 seller payment is enabled.

## User value

The existing Agent chat keeps the Veyra principle `Identity → Intent → Route → Safety → Sign → Receipt`.
A separate expandable **Agent economy** explorer now supports:

1. Browsing Circle's **live public x402 Discovery API** via a same-origin BFF proxy.
2. Searching and filtering service metadata by query, category and maximum per-call USDC price.
3. Seeing the service provider, declared payment network, Gateway support and verified USDC quote where available.
4. Selecting a listing and calculating an **informational budget estimate** for 1–100 calls, using integer atomic amounts only.
5. Accessing Circle's official Skills, wallet setup and Marketplace pages.

The explorer is **not a wallet, payment, quote, endorsement or agent permission**. Listing metadata and prices are untrusted. Service listings can change; every future paid call requires fresh provider, price, schema, chain, token, wallet and policy verification.

## Integration details

- Browser: `src/components/agent/CircleAgentEconomyPanel.tsx`
- Pure normalization & budget preview: `src/core/agent/circleServiceDiscovery.ts`
- Test coverage: `src/tests/circleServiceDiscovery.test.ts`
- Same-origin endpoint: `GET /api/agent/services?q=<query>&category=<category>&maxUsdPrice=<decimal>`
- Express backend route: `server/bff.ts` / Vercel Vite serverless function: `api/agent/services.ts`
- Shared validation and public upstream call: `src/core/agent/circleDiscoveryEndpoint.ts`
- Circle upstream: `https://api.circle.com/v2/x402/discovery/resources` — public, keyless, HTTP GET only

Both server endpoints use a **hard-coded Circle URL** (no user-controlled upstream/SSRF), enforces bounded query length and filter allowlists, adds a 7-second abort and the existing rate limits, and returns at most 18 sanitized cards. The UI never fetches service endpoints, signs for a wallet, sends credentials or makes an x402 payment.

The formatter shows a price in USDC only if the quote's EIP-155 chain and token address match Veyra's canonical `getUsdc(chainId)` facts with 6 decimals. Other assets/chains show **Quote unknown** and cannot be treated as budget-authorized.

### Circle development assistants

Circle Skills provide guidance for implementing USDC, Gateway, Agent Wallets and x402 flows; they are **developer-time skills**, not a runtime dependency of the Veyra Agent UI. Install locally through:

```sh
npx skills add circlefin/skills
```

For up-to-date SDK details, Circle MCP can be connected through a developer's AI coding environment, e.g. with Codex:

```sh
codex mcp add circle --url https://api.circle.com/v1/codegen/mcp
```

Never embed API keys, OTPs, seed phrases or access tokens in source, prompts, browser bundles or telemetry.

## Explicitly deferred (no auto-enable)

- **Agent Wallets:** requires user-initiated Circle Terms acceptance and a wallet bootstrap flow. No wallet provisioned by this branch.
- **Spending policies:** Circle's custom policy setup is **mainnet only** and OTP-gated. Policy updates must be made by the user in their own terminal; no Agent access to OTP.
- **Paid x402 requests / Gateway Nanopayments:** require exact merchant endpoint and response-schema review, a dedicated Agent wallet, independent budget checks, spend ledger and idempotency, fresh quotes, chain/provider health, verified receipts and E2E production evidence.
- **Merchant trust:** mere appearance in the Marketplace is not a guarantee of quality, authorization or safe output.
- **Direct paid API execution:** unavailable. The current Agent may prepare actions, but Veyra execution still requires deterministic review and user wallet signatures.

## Next promotion gates

1. CI green: typecheck, lint, unit tests and production build.
2. Real API smoke test: BFF reaches Circle public Discovery, renders listings and handles empty/unavailable states.
3. Test abnormal inputs (malicious URLs/metadata, unknown token addresses, quote amounts, rate limiting).
4. Separately design human-approved wallet onboarding and, later, controlled paid x402 calls behind a disabled feature flag, using Veyra action IDs and an append-only payment ledger.
5. No mainnet promotion without separate security and E2E approval.

## Primary references

- https://www.circle.com/blog/discover-the-whole-agent-marketplace-in-one-call
- https://developers.circle.com/ai/mcp
- https://github.com/circlefin/skills
- https://agents.circle.com/skills/setup.md
- https://github.com/circlefin/skills/blob/master/plugins/circle/skills/agent-wallet-policy/SKILL.md
