-- Veyra v1 journey arbitration. Additive, safe to retry; never rewrite
-- 0022 or earlier migrations. All terminal states derive from trusted
-- onchain-verified mainnet_settlement_receipts, NEVER browser status/hash.
CREATE TABLE IF NOT EXISTS mainnet_pay_journeys (
  journey_id text PRIMARY KEY CHECK (journey_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  owner_user_id text NOT NULL REFERENCES veyra_users(veyr_user_id),
  owner_wallet text NOT NULL CHECK(owner_wallet ~* '^0x[0-9a-f]{40}$'),
  payee_wallet text NOT NULL CHECK(payee_wallet ~* '^0x[0-9a-f]{40}$'),
  amount_raw text NOT NULL CHECK(amount_raw ~ '^[1-9][0-9]*$' AND amount_raw::numeric<=1000000000000),
  payment_ref text NOT NULL CHECK(payment_ref ~* '^0x[0-9a-f]{64}$'),
  request_id text REFERENCES veyra_payment_requests(request_id),
  gateway_operation_id text NOT NULL UNIQUE CHECK(gateway_operation_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  verified_tx_hash text REFERENCES mainnet_settlement_receipts(tx_hash),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  CONSTRAINT journey_terminal_proof CHECK(
    (verified_tx_hash IS NULL AND verified_at IS NULL)
    OR (verified_tx_hash IS NOT NULL AND verified_at IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_mainnet_pay_journey_one_unresolved_wallet
  ON mainnet_pay_journeys(owner_user_id,lower(owner_wallet))
  WHERE verified_tx_hash IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_mainnet_pay_journey_one_unresolved_request
  ON mainnet_pay_journeys(request_id)
  WHERE request_id IS NOT NULL AND verified_tx_hash IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_mainnet_pay_journey_ref_owner
  ON mainnet_pay_journeys(owner_user_id,payment_ref);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_mainnet_pay_journeys_owner_history
  ON mainnet_pay_journeys(owner_user_id,created_at DESC);
