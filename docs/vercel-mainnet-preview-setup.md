# Vercel Mainnet-Enabled Preview Setup

This document describes how to create a mainnet-enabled Preview deployment
within the **existing** Vercel project (`veyra-seven-beta.vercel.app`)
without promoting it to Production.

---

## Goal

- One isolated Vercel Preview URL where `VEYRA_ENV=mainnet`
- Production (`veyra-seven-beta.vercel.app`) remains unchanged on `VEYRA_ENV=testnet`
- No new Vercel project, no automatic Production promotion

---

## Step 1 — Push the branch to GitHub

The branch `arc-studio/mainnet` must be pushed to the GitHub remote and the
Vercel project must be linked to the `bearbaba/Veyra` repository.

Confirm current branch status:

```bash
git -C /path/to/veyra log --oneline origin/arc-studio/mainnet -3
```

---

## Step 2 — Configure Vercel Preview environment variables

In the Vercel dashboard for the `veyra-seven-beta` project:

1. Go to **Settings → Environment Variables**
2. For each variable below, set **Environment** to **Preview** and
   **Git Branch** to `arc-studio/mainnet` (branch-specific override)

| Variable | Value for this Preview |
|----------|----------------------|
| `VEYRA_ENV` | `mainnet` |
| `VEYRA_APP_ORIGIN` | The Vercel Preview URL (e.g. `https://veyra-arc-studio-mainnet.vercel.app`) |
| `X_REDIRECT_URI` | `https://<preview-url>/api/auth/x/callback` (if X OAuth needed) |
| All other vars | Copy from Production as-is |

> **Note:** `VEYRA_ENV=mainnet` activates the mainnet identity and login paths.
> It does NOT enable mainnet financial providers (Swap, Bridge, Gateway) — those
> have their own capability-specific gates.

---

## Step 3 — Trigger a Preview deployment

Push a commit to `arc-studio/mainnet` — Vercel automatically creates a
Preview deployment for every push to a non-Production branch.

Or manually trigger via the Vercel CLI:

```bash
npx vercel --cwd /path/to/veyra --token $VERCEL_TOKEN \
  --scope your-team \
  --build-env VEYRA_ENV=mainnet
```

---

## Step 4 — Verify the Preview

1. Open the Vercel Preview URL
2. Connect your wallet to Arc Mainnet (chain ID 5042)
3. Confirm the network label shows "Arc Mainnet"
4. Confirm Settlement page shows "VeyraSettlement not yet deployed on Arc Mainnet"
   (until the contract is deployed)
5. Confirm no Production changes occurred

---

## What NOT to do

- Do NOT set `VEYRA_ENV=mainnet` on the **Production** environment until
  the canary payment is verified and explicit promotion is authorized
- Do NOT use the Vercel "Promote to Production" button for a Preview
  with unverified mainnet contract state
- Do NOT create a new Vercel project — use the existing `veyra-seven-beta` project

---

## After mainnet deployment and canary payment

Once VeyraSettlement is deployed on Arc Mainnet and the canary payment is
verified on-chain, promotionrequires explicit authorization:

1. Arc Studio updates `src/config/veyraSettlement.ts` with the mainnet address
2. You verify the Settlement UI on the Preview URL
3. You explicitly authorize Production promotion
4. Vercel "Promote to Production" is clicked manually by you — never automatically
