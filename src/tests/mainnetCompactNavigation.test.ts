import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const shell = read('components/layout/AppShell.tsx');
const home = read('components/pages/MainnetHomePage.tsx');
const commands = read('components/command/CommandBar.tsx');

describe('Mainnet navigation keeps financial actions up front', () => {
  it('orders the desktop primary actions Home, Friends, Pay, Swap, Bridge', () => {
    const mainnetPrimary = shell.slice(shell.indexOf("const PRIMARY_NAV"), shell.indexOf("] : [", shell.indexOf("const PRIMARY_NAV")));
    const ids = [...mainnetPrimary.matchAll(/id: '([^']+)'/g)].map(m => m[1]);
    expect(ids).toEqual(['home', 'social', 'settlement', 'convert', 'bridge']);
  });

  it('Activity is a working History item, below the primary financial actions', () => {
    const history = shell.slice(shell.indexOf('const HISTORY_NAV'), shell.indexOf('const SECONDARY_NAV'));
    expect(history).toContain("id: 'activity'");
    expect(history).not.toContain('soon: true');
    expect(shell).toContain('>History</p>');
    expect(shell).toContain('HISTORY_NAV.map');
  });

  it('phone bottom bar prioritizes Home, Pay, Swap and Bridge, with Activity first in More', () => {
    expect(shell).toContain("['home', 'settlement', 'convert', 'bridge'].includes(item.id)");
    expect(shell).toContain('[...HISTORY_NAV, ...PRIMARY_NAV.filter(item => item.id === \'social\'), ...SECONDARY_NAV]');
    expect(shell).toContain('aria-current={moreActive?\'page\':undefined}');
  });

  it('Home quick actions put Pay, Swap, Bridge before Friends and Activity', () => {
    const shortcutSource = home.slice(home.indexOf("{id:'send',label:'Pay'"), home.indexOf("{id:'activity',label:'Activity'")+45);
    const labels = [...shortcutSource.matchAll(/label:'(Pay|Swap|Bridge|Friends|Activity)'/g)].map(m=>m[1]);
    expect(labels).toEqual(['Pay', 'Swap', 'Bridge', 'Friends', 'Activity']);
  });

  it('command palette keeps Swap and Bridge in Core and Activity in More', () => {
    const core = commands.slice(commands.indexOf("const PRIMARY_ACTIONS"), commands.indexOf("] : [", commands.indexOf("const PRIMARY_ACTIONS")));
    const more = commands.slice(commands.indexOf("const SECONDARY_ACTIONS"), commands.indexOf("] : [", commands.indexOf("const SECONDARY_ACTIONS")));
    expect(core).toContain("label: 'Swap'");
    expect(core).toContain("label: 'Bridge'");
    expect(core).not.toContain("label: 'Activity'");
    expect(more).toContain("label: 'Activity'");
  });
});
