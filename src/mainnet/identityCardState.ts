import type { IdentityOriginStatus } from '@/lib/api/identityOriginProbe';

/**
 * What the Home identity card may truthfully say about a connected wallet.
 *
 * Before a session exists the app cannot know whether the wallet already has a
 * Veyra ID: the backend deliberately offers no wallet-to-ID lookup before
 * sign-in. "Not set up" was therefore a claim Home could not back, and it also
 * flashed while a secure session restore was still running. The Friends page
 * leads with "Sign in"; this keeps Home consistent with it.
 */
export type IdentityCardState = 'connect' | 'checking' | 'active' | 'signed-out' | 'unavailable';

export interface IdentityCardView {
  state: IdentityCardState;
  badge: string;
  detail: string;
  cta: string;
  tone: 'success' | 'muted' | 'warning';
}

export function identityCardView(input: {
  connected: boolean;
  signedIn: boolean;
  origin: IdentityOriginStatus;
  restoring: boolean;
}): IdentityCardView {
  if (!input.connected) {
    return { state: 'connect', badge: 'Not connected', detail: 'Connect a wallet to get started', cta: 'Set up Veyra ID', tone: 'muted' };
  }
  if (input.signedIn && input.origin === 'ready') {
    return { state: 'active', badge: 'Active', detail: 'Ready to pay and receive', cta: 'Manage identity', tone: 'success' };
  }
  if (input.origin === 'checking' || input.restoring) {
    return { state: 'checking', badge: 'Checking…', detail: 'Checking your Veyra ID session', cta: 'Open Veyra ID', tone: 'muted' };
  }
  if (input.origin === 'ready') {
    return { state: 'signed-out', badge: 'Signed out', detail: 'Sign in or create your ID to pay by name', cta: 'Sign in or create ID', tone: 'muted' };
  }
  return { state: 'unavailable', badge: 'Unavailable', detail: 'Veyra ID is unavailable on this connection', cta: 'Open Veyra ID', tone: 'warning' };
}
