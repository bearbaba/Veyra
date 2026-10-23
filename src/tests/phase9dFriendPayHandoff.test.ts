import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
const read=(p:string)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
describe('one Veyra friends-to-payment review',()=>{
  it('hands off a friendly Veyra ID, not a wallet address or signed transaction',()=>{
    const social=read('components/pages/SocialPage.tsx');
    const app=read('App.tsx');
    expect(social).toContain('onPayFriend(friendLabel(item))');
    expect(social).toContain("item.state==='CONNECTED'&&item.veyraHandle");
    expect(app).toContain("setPage('pay')");
    expect(app).toContain('friendRecipient={friendPayment}');
    expect(app).not.toContain('eth_sendTransaction');
  });
  it('invalidates any old payment review and re-resolves the recipient',()=>{
    const pay=read('components/pages/PayPage.tsx');
    expect(pay).toContain('setPendingAction(null);');
    expect(pay).toContain('setPreparedRecipient(null);');
    expect(pay).toContain('await preparePaymentRecipient(recipient, ARC_TESTNET_CHAIN_ID)');
    expect(pay).toContain('TransactionReviewSheet');
  });
});
