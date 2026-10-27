import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(new URL('../' + name, import.meta.url), 'utf8');

describe('Agent conversation privacy and safe handoff', () => {
  it('keys the entire conversation component to the connected wallet and signed ID', () => {
    const page = read('components/pages/AgentPage.tsx');
    expect(page).toContain('const { address, chainId, connector } = useAccount()');
    expect(page).toContain('social.session?.walletKey === walletKey');
    expect(page).toContain('signedSession.profile.veyraUserId');
    expect(page).toContain('<ScopedAgentPage key={historyScope ?? walletKey');
    expect(page).toContain('if (!historyKey) return []');
    expect(page).not.toContain("sessionStorage.getItem('veyra:agent-history')");
    expect(page).not.toContain("sessionStorage.setItem('veyra:agent-history'");
  });
  it('does not sign from Agent chat or bypass deterministic execution review', () => {
    const page = read('components/pages/AgentPage.tsx');
    expect(page).toContain("execution: 'LOCKED'");
    expect(page).toContain('<ActionCard intent={message.intent} onNavigate={onNavigate} />');
    expect(page).not.toContain('sendTransaction(');
    expect(page).not.toContain('writeContract(');
    expect(page).not.toContain('walletClient.sign');
  });
  it('will not persist anonymous or unsigned conversations to a shared browser key', () => {
    const page = read('components/pages/AgentPage.tsx');
    expect(page).toContain('historyScope ?');
    expect(page).toContain('if (historyKey && messages.length > 0)');
    expect(page).toContain("sessionStorage.removeItem('veyra:agent-history')");
    expect(page).toContain('if (historyKey) sessionStorage.removeItem(historyKey)');
  });
});
