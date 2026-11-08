import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { identityCardView } from '../mainnet/identityCardState';

const base = { connected: true, signedIn: false, origin: 'ready', restoring: false } as const;

describe('Home identity card state', () => {
  it('never claims "Not set up": the app cannot know before sign-in', () => {
    for (const origin of ['checking', 'ready', 'origin_blocked', 'offline'] as const) {
      for (const restoring of [true, false]) {
        const view = identityCardView({ ...base, origin, restoring });
        expect(`${view.badge} ${view.cta}`).not.toMatch(/not set up/i);
        expect(view.detail).not.toBe('Create your ID to pay by name');
      }
    }
  });

  it('disconnected wallet gets the connect prompt', () => {
    expect(identityCardView({ ...base, connected: false }).state).toBe('connect');
  });

  it('signed in on a ready origin is the only Active state', () => {
    expect(identityCardView({ ...base, signedIn: true }).state).toBe('active');
    for (const origin of ['checking', 'origin_blocked', 'offline'] as const) {
      expect(identityCardView({ ...base, signedIn: true, origin }).state).not.toBe('active');
    }
  });

  it('shows a checking state while the origin probe or session restore is running', () => {
    expect(identityCardView({ ...base, origin: 'checking' }).state).toBe('checking');
    expect(identityCardView({ ...base, restoring: true }).state).toBe('checking');
  });

  it('offers sign-in or create once the origin is ready and no session exists', () => {
    const view = identityCardView(base);
    expect(view.state).toBe('signed-out');
    expect(view.cta).toBe('Sign in or create ID');
  });

  it('reports blocked or offline identity as unavailable, with a warning tone', () => {
    for (const origin of ['origin_blocked', 'offline'] as const) {
      const view = identityCardView({ ...base, origin });
      expect(view.state).toBe('unavailable');
      expect(view.tone).toBe('warning');
    }
  });

  it('Home renders the card from this function instead of hard-coded wording', () => {
    const home = readFileSync(new URL('../components/pages/MainnetHomePage.tsx', import.meta.url), 'utf8');
    expect(home).toContain('identityCardView(');
    expect(home).toContain('{idCard.badge}');
    expect(home).toContain('{idCard.detail}');
    expect(home).not.toContain("'Not set up'");
    expect(home).not.toContain("'Create your ID to pay by name'");
  });
});
