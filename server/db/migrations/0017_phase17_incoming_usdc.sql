-- Incoming Arc Testnet ERC20 USDC: immutable chain evidence plus owner-private alerts.
-- Only BFF on-chain verification writes these records. No user write API.
CREATE TABLE verified_incoming_usdc (
  incoming_id text PRIMARY KEY,
  owner_user_id text NOT NULL REFERENCES veyra_users(veyr_user_id),
  wallet_id text NOT NULL REFERENCES wallet_bindings(wallet_id),
  chain_id bigint NOT NULL CHECK(chain_id=5042002),
  token_address text NOT NULL,
  tx_hash text NOT NULL,
  log_index bigint NOT NULL CHECK(log_index>=0),
  block_number bigint NOT NULL CHECK(block_number>=0),
  block_hash text NOT NULL,
  sender_address text NOT NULL,
  recipient_address text NOT NULL,
  amount_base_units text NOT NULL CHECK(amount_base_units ~ '^[0-9]{1,78}$'),
  verified_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_verified_incoming_usdc_chain_log UNIQUE(chain_id,tx_hash,log_index)
);
--> statement-breakpoint
CREATE INDEX ix_verified_incoming_owner_recent ON verified_incoming_usdc(owner_user_id,verified_at DESC);
--> statement-breakpoint
CREATE TABLE incoming_usdc_cursors (
  wallet_id text PRIMARY KEY REFERENCES wallet_bindings(wallet_id),
  chain_id bigint NOT NULL CHECK(chain_id=5042002),
  last_verified_block bigint NOT NULL CHECK(last_verified_block>=0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
