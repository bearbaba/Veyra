-- Mainnet V1: owner-private typed USDC requests with immutable parties,
-- amount, verified receiving wallet, and deterministic onchain payment reference.
-- No migration is run by frontend deploys; Production requires separate backup.
CREATE TABLE IF NOT EXISTS veyra_payment_requests (
 request_id text PRIMARY KEY CHECK(request_id ~ '^prq_[1-9A-HJ-NP-Za-km-z]{10,}$'),
 requester_user_id text NOT NULL REFERENCES veyra_users(veyr_user_id),
 payer_user_id text NOT NULL REFERENCES veyra_users(veyr_user_id),
 client_request_id text NOT NULL CHECK(client_request_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 amount_raw text NOT NULL CHECK(amount_raw ~ '^[1-9][0-9]*$' AND amount_raw::numeric<=1000000000000),
 chain_id bigint NOT NULL DEFAULT 5042 CHECK(chain_id=5042),
 recipient_wallet text NOT NULL CHECK(recipient_wallet ~* '^0x[0-9a-f]{40}$'),
 recipient_wallet_id text NOT NULL,
 payment_ref text NOT NULL CHECK(payment_ref ~ '^0x[0-9a-f]{64}
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PAID','CANCELLED','EXPIRED')),
 tx_hash text REFERENCES mainnet_settlement_receipts(tx_hash),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 paid_at timestamptz,
 cancelled_at timestamptz,
 CONSTRAINT payment_request_distinct_people CHECK(requester_user_id<>payer_user_id),
 CONSTRAINT payment_request_expiry_after_creation CHECK(expires_at>created_at),
 CONSTRAINT payment_request_claim_complete CHECK(
  (claim_id IS NULL AND claim_wallet IS NULL AND claimed_at IS NULL)
  OR (claim_id IS NOT NULL AND claim_wallet IS NOT NULL AND claimed_at IS NOT NULL)),
 CONSTRAINT payment_request_lifecycle CHECK(
  (status='PENDING' AND tx_hash IS NULL AND paid_at IS NULL AND cancelled_at IS NULL)
  OR (status='PAID' AND tx_hash IS NOT NULL AND paid_at IS NOT NULL AND cancelled_at IS NULL)
  OR (status='CANCELLED' AND tx_hash IS NULL AND paid_at IS NULL AND cancelled_at IS NOT NULL)
  OR (status='EXPIRED' AND tx_hash IS NULL AND paid_at IS NULL AND cancelled_at IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_requests_requester_client
 ON veyra_payment_requests(requester_user_id,client_request_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_requests_ref
 ON veyra_payment_requests(payment_ref);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_requests_tx
 ON veyra_payment_requests(tx_hash) WHERE tx_hash IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_payment_requests_requester
 ON veyra_payment_requests(requester_user_id,created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_payment_requests_payer
 ON veyra_payment_requests(payer_user_id,created_at DESC);
),
 claim_id text CHECK(claim_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PAID','CANCELLED','EXPIRED')),
 tx_hash text REFERENCES mainnet_settlement_receipts(tx_hash),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 paid_at timestamptz,
 cancelled_at timestamptz,
 CONSTRAINT payment_request_distinct_people CHECK(requester_user_id<>payer_user_id),
 CONSTRAINT payment_request_expiry_after_creation CHECK(expires_at>created_at),
 CONSTRAINT payment_request_lifecycle CHECK(
  (status='PENDING' AND tx_hash IS NULL AND paid_at IS NULL AND cancelled_at IS NULL)
  OR (status='PAID' AND tx_hash IS NOT NULL AND paid_at IS NOT NULL AND cancelled_at IS NULL)
  OR (status='CANCELLED' AND tx_hash IS NULL AND paid_at IS NULL AND cancelled_at IS NOT NULL)
  OR (status='EXPIRED' AND tx_hash IS NULL AND paid_at IS NULL AND cancelled_at IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_requests_requester_client
 ON veyra_payment_requests(requester_user_id,client_request_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_requests_ref
 ON veyra_payment_requests(payment_ref);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_requests_tx
 ON veyra_payment_requests(tx_hash) WHERE tx_hash IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_payment_requests_requester
 ON veyra_payment_requests(requester_user_id,created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_payment_requests_payer
 ON veyra_payment_requests(payer_user_id,created_at DESC);
),
 claim_wallet text CHECK(claim_wallet ~* '^0x[0-9a-f]{40}
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PAID','CANCELLED','EXPIRED')),
 tx_hash text REFERENCES mainnet_settlement_receipts(tx_hash),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 paid_at timestamptz,
 cancelled_at timestamptz,
 CONSTRAINT payment_request_distinct_people CHECK(requester_user_id<>payer_user_id),
 CONSTRAINT payment_request_expiry_after_creation CHECK(expires_at>created_at),
 CONSTRAINT payment_request_lifecycle CHECK(
  (status='PENDING' AND tx_hash IS NULL AND paid_at IS NULL AND cancelled_at IS NULL)
  OR (status='PAID' AND tx_hash IS NOT NULL AND paid_at IS NOT NULL AND cancelled_at IS NULL)
  OR (status='CANCELLED' AND tx_hash IS NULL AND paid_at IS NULL AND cancelled_at IS NOT NULL)
  OR (status='EXPIRED' AND tx_hash IS NULL AND paid_at IS NULL AND cancelled_at IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_requests_requester_client
 ON veyra_payment_requests(requester_user_id,client_request_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_requests_ref
 ON veyra_payment_requests(payment_ref);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_requests_tx
 ON veyra_payment_requests(tx_hash) WHERE tx_hash IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_payment_requests_requester
 ON veyra_payment_requests(requester_user_id,created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_payment_requests_payer
 ON veyra_payment_requests(payer_user_id,created_at DESC);
),
 claimed_at timestamptz,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PAID','CANCELLED','EXPIRED')),
 tx_hash text REFERENCES mainnet_settlement_receipts(tx_hash),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 paid_at timestamptz,
 cancelled_at timestamptz,
 CONSTRAINT payment_request_distinct_people CHECK(requester_user_id<>payer_user_id),
 CONSTRAINT payment_request_expiry_after_creation CHECK(expires_at>created_at),
 CONSTRAINT payment_request_lifecycle CHECK(
  (status='PENDING' AND tx_hash IS NULL AND paid_at IS NULL AND cancelled_at IS NULL)
  OR (status='PAID' AND tx_hash IS NOT NULL AND paid_at IS NOT NULL AND cancelled_at IS NULL)
  OR (status='CANCELLED' AND tx_hash IS NULL AND paid_at IS NULL AND cancelled_at IS NOT NULL)
  OR (status='EXPIRED' AND tx_hash IS NULL AND paid_at IS NULL AND cancelled_at IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_requests_requester_client
 ON veyra_payment_requests(requester_user_id,client_request_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_requests_ref
 ON veyra_payment_requests(payment_ref);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_requests_tx
 ON veyra_payment_requests(tx_hash) WHERE tx_hash IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_payment_requests_requester
 ON veyra_payment_requests(requester_user_id,created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_payment_requests_payer
 ON veyra_payment_requests(payer_user_id,created_at DESC);
