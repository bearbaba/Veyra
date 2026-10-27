import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
const src=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
describe('reviewed recipient identity and account UX',()=>{
  it('shows historical Veyra ID only when the user used an ID snapshot',()=>{
    expect(src('components/transfer/TransactionReviewSheet.tsx')).toContain('reviewedVeyraHandle: recipient.snapshot.veyraHandle');
    const r=src('components/receipt/VeyraReceiptView.tsx');
    expect(r).toContain("receipt.status==='VERIFIED'&&receipt.recipientVeyraHandleAtReview");
    expect(r).toContain('Direct wallet transfer or no reviewed Veyra ID');
    expect(r).toContain('Copy receipt ID');
  });
  it('copies Veyra ID and allows disconnect without granting financial authority',()=>{
    const s=src('components/pages/SettingsPage.tsx');
    expect(s).toContain('Copy Veyra ID');
    expect(s).toContain('Disconnect wallet');
    expect(s).toContain('await social.signOut()');
    expect(s).not.toContain("fetch('/api/auth/session/logout'");
    expect(s).toContain('await disconnectAsync()');
    expect(s).toContain("disabled={xCapability!=='available'");
    expect(s).toContain('getXLinkCapability()');
  });
});
