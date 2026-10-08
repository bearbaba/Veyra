import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { veyraUsers } from './identity.js';

/**
 * Short-lived OAuth state records for linking external identities.
 * The PKCE verifier is server-side only and is consumed exactly once.
 */
export const oauthLinkStates = pgTable(
  'oauth_link_states',
  {
    oauthStateId: text('oauth_state_id').primaryKey(),
    stateHash: text('state_hash').notNull(),
    veyraUserId: text('veyr_user_id').notNull().references(() => veyraUsers.veyraUserId),
    provider: text('provider').notNull(),
    codeVerifier: text('code_verifier').notNull(),
    redirectUri: text('redirect_uri').notNull(),
    returnPath: text('return_path').notNull().default('/settings'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uix_oauth_link_states_state_hash').on(t.stateHash),
    index('ix_oauth_link_states_user_provider').on(t.veyraUserId, t.provider, t.issuedAt),
    index('ix_oauth_link_states_expiry').on(t.expiresAt),
  ],
);
