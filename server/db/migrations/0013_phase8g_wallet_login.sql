-- Phase 8G: purpose-specific, single-use wallet login challenge.
-- Never reuse ownership/binding proofChallenges for authentication.
CREATE TABLE wallet_login_challenges (
  challenge_id text PRIMARY KEY,
  veyr_user_id text NOT NULL REFERENCES veyra_users(veyr_user_id),
  wallet_address text NOT NULL,
  chain_id bigint NOT NULL,
  nonce text NOT NULL CHECK (nonce ~ '^0x[0-9a-f]{64}$'),
  app_origin text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  status text NOT NULL DEFAULT 'ISSUED'
    CHECK (status IN ('ISSUED', 'CONSUMED', 'EXPIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_login_expiration CHECK (expires_at > issued_at),
  CONSTRAINT chk_login_consumed CHECK (
    (status = 'CONSUMED' AND consumed_at IS NOT NULL) OR
    (status <> 'CONSUMED' AND consumed_at IS NULL)
  )
);
--> statement-breakpoint
CREATE INDEX ix_wallet_login_user_issued ON wallet_login_challenges(veyr_user_id, issued_at DESC);
--> statement-breakpoint
CREATE INDEX ix_wallet_login_active ON wallet_login_challenges(status, expires_at);
