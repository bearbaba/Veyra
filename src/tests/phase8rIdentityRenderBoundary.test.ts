import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const entry = readFileSync(new URL('../identity-beta/main.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../identity-beta/styles.css', import.meta.url), 'utf8');

describe('Identity Beta render failure fallback', () => {
  it('renders the identity application inside a recoverable boundary', () => {
    expect(entry).toContain('class IdentityRenderBoundary extends Component');
    expect(entry).toContain('static getDerivedStateFromError()');
    expect(entry).toContain('<IdentityRenderBoundary><IdentityBetaApp /></IdentityRenderBoundary>');
  });
  it('never displays exception details or secrets on fallback, and provides explicit reload', () => {
    expect(entry).toContain('role="alert"');
    expect(entry).toContain('onClick={() => window.location.reload()}');
    expect(entry).toContain('No payments or transfers were initiated.');
    expect(entry).not.toContain('componentDidCatch');
    expect(css).toContain('.vi-fallback');
  });
});
