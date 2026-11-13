-- Additive Mainnet contract Settlement receipt index, isolated from old direct-Pay
-- receipts. Migration is intentionally NOT executed by frontend builds.
-- Apply only with verified backup and explicit Mainnet database target.
CREATE TABLE IF NOT EXISTS mainnet_settlement_receipts (
 tx_hash text PRIMARY KEY CHECK(tx_hash ~ '^0x[0-9a-f]{64}$'),
 chain_id bigint NOT NULL CHECK(chain_id=5042),
 contract_address text NOT NULL,
 payment_id text NOT NULL CHECK(payment_id ~ '^0x[0-9a-f]{64}$'),
 payment_ref text NOT NULL CHECK(payment_ref ~ '^0x[0-9a-f]{64}$'),
 sender_address text NOT NULL,
 recipient_address text NOT NULL,
 sender_user_id text REFERENCES veyra_users(veyr_user_id),
 recipient_user_id text REFERENCES veyra_users(veyr_user_id),
 recipient_snapshot_id text REFERENCES identity_snapshots(snapshot_id),
 recipient_label text,
 amount_raw text NOT NULL CHECK(amount_raw ~ '^[1-9][0-9]*$'),
 net_amount_raw text NOT NULL CHECK(net_amount_raw ~ '^[1-9][0-9]*$'),
 protocol_fee_raw text NOT NULL CHECK(protocol_fee_raw ~ '^[0-9]+$'),
 network_fee_wei text NOT NULL CHECK(network_fee_wei ~ '^[0-9]+$'),
 block_number bigint NOT NULL CHECK(block_number>0),
 paid_at timestamptz NOT NULL,
 sender_private_note text CHECK(char_length(sender_private_note)<=120),
 created_at timestamptz NOT NULL DEFAULT now(),
 verified_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT settlement_payer_or_receiver_bound CHECK(sender_user_id IS NOT NULL OR recipient_user_id IS NOT NULL),
 CONSTRAINT settlement_net_fee_matches_gross CHECK(
  (amount_raw::numeric)=(net_amount_raw::numeric)+(protocol_fee_raw::numeric))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_mainnet_settlement_sender
 ON mainnet_settlement_receipts(sender_user_id,paid_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_mainnet_settlement_recipient
 ON mainnet_settlement_receipts(recipient_user_id,paid_at DESC);
