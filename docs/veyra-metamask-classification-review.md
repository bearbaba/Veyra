# Veyra — MetaMask website security classification review

**Status:** exact flagged URL and warning type are NOT independently confirmed;
review request not confirmed / **do not claim a clearance**.
This is an operator-ready evidence template, not a request already submitted.
**Never submit a false-positive review for an assumed URL:** the blocked origin
might be a Studio Preview URL rather than the canonical Vercel production URL.

## Public website versus URL actually flagged

- Intended canonical Veyra public URL: https://veyra-seven-beta.vercel.app
- **Actual flagged URL: NOT YET VERIFIED. Copy it verbatim from the current
  MetaMask warning screenshot before requesting a reclassification.**
- A `*.preview.studio.arc.io` origin, a Vercel Preview and the Vercel
  Production hostname are separate URL classifications. Do not assume one
  warning applies to another domain or request delisting for all three.
- Open-source repo: https://github.com/bearbaba/Veyra
- Current stable branch: `develop` (older production bundle)
- Tested upgrade branch: `phase5-production-bridge-flow`
- Production domain is not the same as a Vercel auth-protected Preview URL.

## What Veyra actually does

Veyra is a self-custodial Arc USDC payment and receipt app. The reviewed
unified web UI has a **Testnet (default) / Mainnet** selector with different
financial execution boundaries. The current public release candidate:

1. Testnet: direct wallet-reviewed Arc Testnet USDC transfer with a
   one-USDC cap per approved request. Wallet confirmation is explicit.
2. Mainnet: **public RPC reads + payment simulation only**. Wallet signing
   and real-money transfers are disabled. Mainnet Bridge/Convert are off.
3. Does not ask users for private keys, mnemonic/seed phrases or passwords.
   Does not automatically switch wallet networks or initiate approvals when
   selecting a tab. AI may answer questions but never signs transactions.
4. Verifies transaction receipts independently on the relevant chain.
   Recovery conservatively locks uncertain transactions against accidental
   repeated submission.

These are claims about the candidate source and its static build tests,
**not** a third-party security audit.

## Reviewer evidence (complete before submitting)

- [ ] **Exact flagged URL, not just the project website**, and an unedited screenshot of the actual warning
      including MetaMask version/platform, date and timestamp.
- [ ] State if the warning occurs before connection, on request to connect,
      or specifically on signing/transaction simulation.
- [ ] Provide stable Production deployment SHA and the candidate PR SHA.
- [ ] Confirm screenshots of the public website and explicit network labels;
      don't use browser wallet seed phrases or real balance screenshots.
- [ ] Attach CI/browser acceptance references:
      `e2e/browser-acceptance.mjs`,
      `e2e/arc-mainnet-live-readonly.mjs`,
      `scripts/check-unified-production-release.ts`.
- [ ] Identify whether the warning is on `preview.studio.arc.io`, a Vercel
      Preview, or the public Vercel hostname. A preview-owned subdomain may
      require platform-owner investigation. Do not assume the cause.
- [ ] Distinguish a URL-phishing classification from a **transaction or
      token-approval security simulation alert**; both appear in wallet UX,
      but the evidence and review channel may differ.
- [ ] List **only verified** network/contract addresses and relevant
      explorer proofs. No unverifiable claims of being audited.

## Reviewer-facing request (English)

Subject: Request manual review of MetaMask website security classification — Veyra

Hello MetaMask Security Team,

I'm requesting a manual review of the exact URL shown in my warning:
**[PASTE EXACT FLAGGED URL FROM METAMASK WARNING]**

The intended Veyra public website is:
https://veyra-seven-beta.vercel.app

Please do not assume these two URLs are identical.

Veyra is an open-source, self-custodial app focused on USDC payments on Arc.
Its source is available at:
https://github.com/bearbaba/Veyra

Our candidate user interface defaults to Arc Testnet (chain 5042002), where
a capped USDC transfer requires explicit user wallet approval. It also
offers a separate Arc Mainnet (chain 5042) view for balance inspection and
**read-only simulation**; real-money signing remains disabled.

The app does not request seed phrases or private keys, does not silently
switch the wallet's network and does not authorize transactions through
its AI assistant.

We would appreciate a manual review of the exact flagged URL and the
specific alert classification shown in the attached screenshot. We can provide the unedited
MetaMask warning screenshot, public source, deterministic build checks and
browser acceptance evidence as requested.

Please let us know whether the warning originates from URL classification,
transaction simulation or another security provider, and what additional
proof would be required.

Thank you for reviewing this report.

## Official MetaMask reporting route

1. Consult https://support.metamask.io/configure/wallet/security-alerts/
2. For a URL alert (not just a transaction warning), contact MetaMask support
   for manual review with the exact URL, network, screenshot and official links.
3. The official MetaMask phishing-detect repository also hosts blocklist
   removal issues: https://github.com/MetaMask/eth-phishing-detect/issues
4. Do not submit duplicate tickets if a valid case is already open. Do not
   instruct users to bypass/disable MetaMask protection to use Veyra.

**Operator note:** Submit this package only after independently confirming
the domain and the actual warning text. Never claim the warning has been
removed unless MetaMask's classification is independently retested.
