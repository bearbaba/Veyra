-- Phase 9A: one Veyra ID -> one private notification inbox.
-- Events are server/database-owned. Browsers may only list/mark OWN items.
-- Financial settlement notices require verified receipt ingestion in a later release.
CREATE TABLE veyra_notifications (
  notification_id text PRIMARY KEY NOT NULL,
  owner_user_id text NOT NULL REFERENCES veyra_users(veyr_user_id),
  actor_user_id text REFERENCES veyra_users(veyr_user_id),
  kind text NOT NULL CHECK (kind IN (
    'FRIEND_REQUEST','FRIEND_ACCEPTED','MESSAGE','PAYMENT_RECEIVED','PAYMENT_STATUS','SECURITY'
  )),
  event_ref text NOT NULL CHECK (length(event_ref) BETWEEN 4 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CONSTRAINT chk_notification_not_self CHECK (actor_user_id IS NULL OR actor_user_id <> owner_user_id),
  CONSTRAINT chk_notification_read_time CHECK (read_at IS NULL OR read_at >= created_at),
  CONSTRAINT uq_notification_owner_event UNIQUE (owner_user_id, kind, event_ref)
);
--> statement-breakpoint
CREATE INDEX ix_veyra_notifications_owner_recent
  ON veyra_notifications (owner_user_id, created_at DESC, notification_id DESC);
--> statement-breakpoint
CREATE INDEX ix_veyra_notifications_owner_unread
  ON veyra_notifications (owner_user_id, created_at DESC) WHERE read_at IS NULL;
--> statement-breakpoint
-- Transactional Friend notifications: no optional BFF side-effect that could
-- get lost when a network process crashes after accepting a friend request.
CREATE FUNCTION insert_friend_notification() RETURNS TRIGGER AS $$
DECLARE recipient text;
DECLARE event_kind text;
BEGIN
  IF NEW.status IN ('PENDING_INITIATOR','PENDING_TARGET') THEN
    recipient := CASE WHEN NEW.initiator_user_id = NEW.user_a_id
      THEN NEW.user_b_id ELSE NEW.user_a_id END;
    event_kind := 'FRIEND_REQUEST';
  ELSIF NEW.status = 'CONNECTED' THEN
    recipient := NEW.initiator_user_id;
    event_kind := 'FRIEND_ACCEPTED';
  ELSE
    RETURN NEW;
  END IF;
  INSERT INTO veyra_notifications (
    notification_id, owner_user_id, actor_user_id, kind, event_ref
  ) VALUES (
    'ntf_' || NEW.connection_id, recipient,
    CASE WHEN recipient = NEW.user_a_id THEN NEW.user_b_id ELSE NEW.user_a_id END,
    event_kind, NEW.connection_id
  ) ON CONFLICT (owner_user_id, kind, event_ref) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER trg_friend_notification
  AFTER INSERT ON social_connections
  FOR EACH ROW EXECUTE FUNCTION insert_friend_notification();
