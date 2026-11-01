# Vercel Mainnet-Enabled Preview Setup

This document describes how to create a mainnet-enabled Preview deployment
within the **existing** Vercel project (`veyra-seven-beta.vercel.app`)
without promoting it to Production.

**The key constraint:** `vercel.json` (committed to `main` / Production) must
retain `VITE_VEYRA_ENV=testnet` — a suite of automated tests assert this.
The mainnet preview uses a separate config file (`vercel.mainnet-preview.json`)
that you manually supply to Vercel for the branch deployment only.

---

## Why not set `VEYRA_ENV=mainnet` as a Vercel Preview env var?

The Vercel `buildCommand` in `vercel.json` **hard-codes** the VITE_ flags inline
as environment-variable prefixes on the command line. Vercel Preview environment
variables cannot override values that are hard-coded into `buildCommand` itself.
Setting `VEYRA_ENV=mainnet` in the Preview env would set the *server-side*
variable, but the build still runs with `VITE_VEYRA_ENV=testnet` baked in.

The correct approach is to supply a separate `vercel.json` for the Preview
deployment. Vercel supports this via the `--local-config` CLI flag or by
temporarily replacing `vercel.json` on the branch.

---

## Option A — Branch-scoped vercel.json replacement (recommended)

This creates a separate commit on `arc-studio/mainnet` that replaces `vercel.json`
with `vercel.mainnet-preview.json`. It does **not** affect `main` or Production.

```bash
# On arc-studio/mainnet branch
cp vercel.mainnet-preview.json vercel.json
git add vercel.json
git commit -m "chore: use mainnet vercel config for Preview deployment"
git push origin arc-studio/mainnet
```

Vercel will build this branch with `VITE_VEYRA_ENV=mainnet`. The Production
branch (`main`) retains the original `vercel.json` with `VITE_VEYRA_ENV=testnet`.

> **Important:** The `arc-studio/mainnet` test suite (`phase7bCoreFourReleaseGates`)
> checks that `vercel.json` contains `VITE_VEYRA_ENV=testnet`. If you replace
> `vercel.json` on the branch, those tests will fail on that branch.
> This is acceptable **only for the isolated preview branch** — it must never
> be merged to `main` or `develop`. Add a branch-protection rule to enforce this.

---

## Option B — Vercel CLI with `--local-config` (no git change)

```bash
vercel deploy \
  --local-config vercel.mainnet-preview.json \
  --scope your-team \
  --token $VERCEL_TOKEN
```

This deploys once from your local machine using the mainnet config.
No branch commit is needed. The generated URL is a Preview URL.

---

## What `vercel.mainnet-preview.json` sets

| Flag | Value | Effect |
|------|-------|--------|
| `VITE_VEYRA_ENV` | `mainnet` | Activates Arc Mainnet RPC, chain ID 5042, mainnet login |
| `VITE_VEYRA_MAINNET_PAY` | `1` | Enables VeyraSettlement Direct Pay on Mainnet |
| `VITE_VEYRA_MAINNET_MVP` | `1` | Enables the minimal mainnet surface |
| `VITE_VEYRA_TESTNET_PAY` | `0` | Disables testnet-specific pay paths |
| `VITE_VEYRA_UI_ONLY` | `0` | Full wallet signing (not read-only preview) |
| `VITE_VEYRA_UNIFIED_STAGING` | `0` | No staging BFF rewrites |

Mainnet Swap, Bridge, Gateway, and Earn remain disabled: their own provider
manifest flags (`mainnetProviderManifest.ts`) are all `enabled: false`.

---

## Step-by-step: option A (git commit on the preview branch)

**Prerequisites:**
- The `arc-studio/mainnet` branch is pushed to `bearbaba/Veyra`
- The Vercel project is linked to that repository
- You have Vercel project access

**Steps:**

1. Check out `arc-studio/mainnet` locally.
2. `cp vercel.mainnet-preview.json vercel.json`
3. `git add vercel.json && git commit -m "chore: mainnet preview vercel config" && git push`
4. In the Vercel dashboard for `veyra-seven-beta`, open the new deployment triggered by that push.
5. Confirm the build log shows `VITE_VEYRA_ENV=mainnet` in the build command.
6. Open the Preview URL and confirm:
   - Network label shows "Arc Mainnet"
   - Settlement page shows "VeyraSettlement not yet deployed on Arc Mainnet"
     (until the contract is deployed and `src/config/veyraSettlement.ts` is updated)
   - No Production changes occurred

---

## What NOT to do

- Do NOT set `VEYRA_ENV=mainnet` only in Vercel's Preview environment variables
  without also replacing the `buildCommand` — the build will still use testnet.
- Do NOT promote the `arc-studio/mainnet` Preview to Production until:
  1. VeyraSettlement is deployed on Arc Mainnet and its address is in `src/config/veyraSettlement.ts`
  2. The canary payment is verified on-chain with `PaymentSettled` event confirmed
  3. Explicit owner authorization is given
- Do NOT create a new Vercel project — use `veyra-seven-beta`.
- Do NOT merge the `vercel.json` replacement into `main` or `develop`.

---

## After mainnet deployment and canary payment

Once VeyraSettlement is deployed on Arc Mainnet and the canary payment is verified:

1. Arc Studio updates `src/config/veyraSettlement.ts` with the mainnet address
2. You push the update to `arc-studio/mainnet`
3. You open the Preview URL and verify the Settlement page works end-to-end
4. You give explicit authorization for Production promotion
5. Vercel "Promote to Production" is clicked manually — never automatically
