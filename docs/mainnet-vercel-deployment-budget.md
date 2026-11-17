# Mainnet release policy — controlled Vercel deployments

Veyra uses Vercel Hobby, which limits new deployments to approximately 100 per 24 hours. Creating a separate Vercel deployment for each small file commit can exhaust that cap before the reviewed Mainnet release is ready. The `git.deploymentEnabled` rule in root `vercel.json` reduces those redundant deployments.

**Branch deployment policy (Vercel Git integration)**

| Branch | Auto-deploy | Financial permissions |
| --- | --- | --- |
| `develop` | Yes: Production, when Git integration is connected and quota allows | No new signatures beyond existing build and backend gates |
| `release-preview/**` | Yes: opt-in Preview only | Preview is **not** Mainnet E2E acceptance; never use production secrets for exploratory testing |
| `feature/**`, `fix/**`, `chore/**`, `chatgpt/**` and other PR branches | No: GitHub CI only | No preview build produced; use local isolated Chromium, Vitest and Mainnet bundle checks |

An explicit positive branch rule overrides the catch-all negative rule. **This does not disable GitHub Actions**: the Mainnet financial gate, full Vitest/Chromium and repo trust checks continue on PRs. `feature/mainnet-identity-authority` remains a GitHub mirror but must not create automatic Preview deployments on every fast-forward.

## How to ship safely

1. Commit incremental changes to a short-lived feature branch. Review the financial change and run GitHub PR CI; avoid merging with red checks.
2. If visual review on a hosted URL is essential, create a **new** `release-preview/<review-name>` branch from the exact reviewed commit and push once. This is an explicit cost to your remaining preview quota, not a release authorization.
3. Merge to the Vercel Production branch **develop** only after the PR gates are green. Do not merge incomplete or experimental payment changes to force a deployment. Confirm the merge SHA tree matches the tested head.
4. Verify Vercel reports **READY**, verify the live domain points to the new SHA, check HTTP status and loaded assets, and scan runtime errors. Never claim production is updated merely because GitHub CI passed.
5. Keep `feature/mainnet-identity-authority` aligned with develop without triggering a redundant Vercel preview. Preserve the emergency read-only kill switch, wallet confirmation and backend release gates.
6. If Vercel responds `402 api-deployments-free-per-day`, **do not retry in a loop** or change the paid plan. Leave the last verified Production build in place, record the pending SHA, and resume release only after quota is genuinely available and a fresh deployment succeeds.
7. Never use the presence of a Preview, SDK callback, wallet signature or Vercel READY status as proof that the destination received funds. Settlement requires independent onchain receipts.

## Verification and limits

- `bun run test` runs `src/tests/mainnetDeployBudget.test.ts` and all other Vitest tests.
- `bun run typecheck`, `bun run lint`, and `bun scripts/build-mainnet-pilot.ts` retain their existing gates.
- Vercel's branch deployment rules are enforced by Vercel, not by the in-repo test. Check actual Vercel behavior after merge; changes to team-level Git settings may also affect deployments.
- The default branch `develop` remains Mainnet. The older Testnet references in archived tests and docs are not permission to connect test funds or to enable old financial routes.

Sources: [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration), [Vercel Hobby deployment limits](https://vercel.com/docs/limits).
