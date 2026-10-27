-- Phase 16. Private-to-participants chat; ciphertext only at rest, NOT E2EE.
-- No plaintext column, no unauthenticated browse API, no wallet signatures.
CREATE TABLE veyra_direct_messages (
  message_id text PRIMARY KEY,
  sender_user_id text NOT NULL REFERENCES veyra_users(veyr_user_id),
  recipient_user_id text NOT NULL REFERENCES veyra_users(veyr_user_id),
  client_request_id text NOT NULL,
  ciphertext text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_direct_message_not_self CHECK(sender_user_id <> recipient_user_id),
  CONSTRAINT chk_direct_message_cipher_length CHECK(length(ciphertext) BETWEEN 4 AND 6000),
  CONSTRAINT chk_direct_message_nonce CHECK(length(iv) = 16),
  CONSTRAINT chk_direct_message_tag CHECK(length(auth_tag) = 24),
  CONSTRAINT uq_direct_message_sender_request UNIQUE(sender_user_id, client_request_id)
);
--> statement-breakpoint
CREATE INDEX ix_direct_message_sender_recent ON veyra_direct_messages(sender_user_id,created_at DESC,message_id DESC);
--> statement-breakpoint
CREATE INDEX ix_direct_message_recipient_recent ON veyra_direct_messages(recipient_user_id,created_at DESC,message_id DESC);
