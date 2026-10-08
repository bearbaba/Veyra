-- Supplemental migration: constraints, partial indexes, triggers, and functions
-- that cannot be expressed in Drizzle's schema DSL.
-- Applied after 0000_phase1_initial.sql.

-- ── Case-insensitive handle uniqueness (amendment 1) ─────────────────────────
-- Drop the plain unique index created by Drizzle and replace with a CI one.
DROP INDEX IF EXISTS "uix_veyra_users_handle_ci";
CREATE UNIQUE INDEX uix_veyra_users_handle_ci
  ON veyra_users (LOWER(veyr_handle))
  WHERE deleted_at IS NULL;

-- ── Active-wallet partial unique index (amendment 7) ─────────────────────────
-- Drop the broad unique index; replace with one that only enforces uniqueness for ACTIVE wallets.
DROP INDEX IF EXISTS "uix_wallet_bindings_address_chain";
CREATE UNIQUE INDEX uix_wallet_bindings_address_chain_active
  ON wallet_bindings (LOWER(wallet_address), chain_id)
  WHERE status = 'ACTIVE' AND revoked_at IS NULL;

-- Active-wallet lookup index.
DROP INDEX IF EXISTS "ix_wallet_bindings_address_lower";
CREATE INDEX ix_wallet_bindings_address_lower
  ON wallet_bindings (LOWER(wallet_address), chain_id)
  WHERE status = 'ACTIVE';

-- Active wallet per user.
DROP INDEX IF EXISTS "ix_wallet_bindings_user";
CREATE INDEX ix_wallet_bindings_user
  ON wallet_bindings (veyr_user_id)
  WHERE status = 'ACTIVE';

-- ── Social graph partial indexes ──────────────────────────────────────────────
DROP INDEX IF EXISTS "ix_social_connections_connected_a";
CREATE INDEX ix_social_connections_connected_a
  ON social_connections (user_a_id, status, created_at DESC)
  WHERE status = 'CONNECTED';

DROP INDEX IF EXISTS "ix_social_connections_connected_b";
CREATE INDEX ix_social_connections_connected_b
  ON social_connections (user_b_id, status, created_at DESC)
  WHERE status = 'CONNECTED';

DROP INDEX IF EXISTS "ix_social_blocks_active_blocker";
CREATE INDEX ix_social_blocks_active_blocker
  ON social_blocks (blocker_user_id, blocked_user_id, status, created_at DESC)
  WHERE status = 'BLOCKED';

-- ── Receipt partial indexes ───────────────────────────────────────────────────
DROP INDEX IF EXISTS "ix_activity_receipts_sender_status";
CREATE INDEX ix_activity_receipts_sender_status
  ON activity_receipts (sender_user_id, status)
  WHERE status NOT IN ('COMPLETE', 'FAILED', 'INVALIDATED', 'DUPLICATE_DETECTED');

DROP INDEX IF EXISTS "ix_activity_receipts_relay_pending";
CREATE INDEX ix_activity_receipts_relay_pending
  ON activity_receipts (status, updated_at ASC)
  WHERE status IN ('RECEIVE_PENDING', 'RECEIVE_FAILED_RETRYABLE');

-- ── Quote expiry partial index ────────────────────────────────────────────────
DROP INDEX IF EXISTS "ix_route_quotes_expiry_sweep";
CREATE INDEX ix_route_quotes_expiry_sweep
  ON route_quotes (veyra_ttl_expires_at ASC)
  WHERE status = 'AVAILABLE';

-- ── Identity snapshot expiry partial index ────────────────────────────────────
DROP INDEX IF EXISTS "ix_identity_snapshots_expiry";
CREATE INDEX ix_identity_snapshots_expiry
  ON identity_snapshots (expires_at ASC)
  WHERE verified_at IS NULL AND invalidated_at IS NULL;

-- ── CHECK constraints ─────────────────────────────────────────────────────────
ALTER TABLE social_follows
  ADD CONSTRAINT chk_social_follows_no_self
  CHECK (follower_user_id <> followee_user_id);

ALTER TABLE social_connections
  ADD CONSTRAINT chk_social_connections_no_self
  CHECK (user_a_id <> user_b_id),
  ADD CONSTRAINT chk_social_connections_canonical_order
  CHECK (user_a_id < user_b_id);

ALTER TABLE social_blocks
  ADD CONSTRAINT chk_social_blocks_no_self
  CHECK (blocker_user_id <> blocked_user_id);

-- ── auto-update updated_at trigger ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_veyra_users_updated_at
  BEFORE UPDATE ON veyra_users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_wallet_bindings_updated_at
  BEFORE UPDATE ON wallet_bindings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_receive_preferences_updated_at
  BEFORE UPDATE ON receive_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_activity_receipts_updated_at
  BEFORE UPDATE ON activity_receipts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_route_quotes_updated_at
  BEFORE UPDATE ON route_quotes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_intents_updated_at
  BEFORE UPDATE ON intents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_linked_identities_updated_at
  BEFORE UPDATE ON linked_identities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── identity_revision increment triggers (amendment 3: concurrency-safe) ─────
-- Uses UPDATE ... SET identity_revision = identity_revision + 1 (atomic in PG).

CREATE OR REPLACE FUNCTION increment_identity_revision()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE veyra_users
    SET identity_revision = identity_revision + 1,
        updated_at = NOW()
  WHERE veyr_user_id = NEW.veyr_user_id;
  RETURN NEW;
END;
$$;

-- Fires on wallet_bindings INSERT (new wallet added).
CREATE TRIGGER trg_wallet_added_revision
  AFTER INSERT ON wallet_bindings
  FOR EACH ROW EXECUTE FUNCTION increment_identity_revision();

-- Fires on wallet_bindings UPDATE where status → REVOKED (amendment 7).
CREATE OR REPLACE FUNCTION increment_identity_revision_on_revoke()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'REVOKED' AND NEW.status = 'REVOKED' THEN
    UPDATE veyra_users
      SET identity_revision = identity_revision + 1,
          updated_at = NOW()
    WHERE veyr_user_id = NEW.veyr_user_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_wallet_revoked_revision
  AFTER UPDATE OF status ON wallet_bindings
  FOR EACH ROW EXECUTE FUNCTION increment_identity_revision_on_revoke();

-- Fires on linked_identities UPDATE where status → REVOKED.
CREATE TRIGGER trg_linked_identity_revoked_revision
  AFTER UPDATE OF status ON linked_identities
  FOR EACH ROW EXECUTE FUNCTION increment_identity_revision_on_revoke();

-- Fires on receive_preferences UPDATE (preference change bumps revision).
CREATE OR REPLACE FUNCTION increment_identity_revision_prefs()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE veyra_users
    SET identity_revision = identity_revision + 1,
        updated_at = NOW()
  WHERE veyr_user_id = NEW.veyr_user_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_receive_preference_revision
  AFTER UPDATE ON receive_preferences
  FOR EACH ROW EXECUTE FUNCTION increment_identity_revision_prefs();

-- ── Append-only enforcement (amendment 8) ────────────────────────────────────
-- execution_events and identity_revisions: UPDATE and DELETE are prohibited.

CREATE OR REPLACE FUNCTION deny_mutation_on_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only: UPDATE and DELETE are not permitted.', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_execution_events_append_only
  BEFORE UPDATE OR DELETE ON execution_events
  FOR EACH ROW EXECUTE FUNCTION deny_mutation_on_append_only();

CREATE TRIGGER trg_identity_revisions_append_only
  BEFORE UPDATE OR DELETE ON identity_revisions
  FOR EACH ROW EXECUTE FUNCTION deny_mutation_on_append_only();

-- ── Schema-forward comments for posts tables ──────────────────────────────────
COMMENT ON TABLE posts IS 'SCHEMA_FORWARD: Phase 9. No application code until Phase 9 approved.';
COMMENT ON TABLE post_interactions IS 'SCHEMA_FORWARD: Phase 9. No application code until Phase 9 approved.';
COMMENT ON TABLE post_tips IS 'SCHEMA_FORWARD: Phase 9. No application code until Phase 9 approved.';
