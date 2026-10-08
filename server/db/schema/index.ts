// Central schema barrel — imported by drizzle.config.ts and the db client.
// Do NOT import posts.ts from application code until Phase 9 is approved.

export * from './enums.js';
export * from './identity.js';
export * from './wallets.js';
export * from './proofChallenges.js';
export * from './snapshots.js';
export * from './social.js';
export * from './payments.js';
// posts.ts is exported here for Drizzle migration generation ONLY.
// Application code must not import post tables directly — see posts.ts header.
export * from './posts.js';
export * from './oauth.js';
export * from './contacts.js';
