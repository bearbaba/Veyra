import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {friendLabel,normalizeFriendName,type SocialFriend} from '../features/social/UnifiedSocial';
const file=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
describe('Veyra unified wallet, social and verified alerts',()=>{
 it('uses canonical @name.veyra; does not confuse X handles with Veyra namespace',()=>{
   expect(normalizeFriendName(' @Alice_42 ')).toBe('@alice_42.veyra');
   expect(normalizeFriendName('alice_42.veyra')).toBe('@alice_42.veyra');
   for(const x of ['alice.eth','alice.x','https://x.com/alice','bob@evil','.veyra','a'])
     expect(()=>normalizeFriendName(x)).toThrow();
 });
 it('only displays verified handle; internal ID is not exposed whole',()=>{
   const friend:SocialFriend={veyraUserId:'usr_123456789ABCDEFGJ',veyraHandle:'alice',state:'CONNECTED',updatedAt:''};
   expect(friendLabel(friend)).toBe('@alice.veyra');
   expect(friendLabel({...friend,veyraHandle:null})).not.toContain(friend.veyraUserId);
 });
 it('reuses the connected wagmi wallet and independently verifies identity EIP-712',()=>{
   const auth=file('features/social/UnifiedSocial.tsx');
   expect(auth).toContain('connector.getProvider()');
   expect(auth).toContain("signReviewedIdentity(w.provider,c,'login'");
   expect(auth).toContain("signReviewedIdentity(w.provider,c,'register'");
   expect(auth).toContain('generation.current++');
   expect(auth).toContain('No financial permissions granted.');
   expect(auth).not.toContain('sessionStorage');
   expect(auth).not.toContain('localStorage');
   expect(auth).not.toContain('eth_sendTransaction');
 });
 it('only accepts authenticated server-side friends and notifications',()=>{
   const auth=file('features/social/UnifiedSocial.tsx');
   const page=file('components/pages/SocialPage.tsx');
   expect(auth).toContain("credentials:'same-origin'");
   expect(auth).toContain("'/api/notifications?limit=20&offset=0'");
   expect(auth).toContain("'/api/notifications/read'");
   expect(auth).not.toContain("'/api/notifications/create'");
   expect(page).toContain('Messaging is not enabled');
   expect(page).not.toContain('Send message');
 });
 it('makes authenticated friends quick-selectable from Pay and hides destructive actions behind profile options',()=>{
   const pay=file('components/pages/PayPage.tsx');
   const social=file('components/pages/SocialPage.tsx');
   const shell=file('components/layout/AppShell.tsx');
   const wallet=file('components/layout/WalletAccountControls.tsx');
   expect(pay).toContain("item.state === 'CONNECTED'");
   expect(pay).toContain('chooseFriend(friendLabel(item))');
   expect(pay).toContain('prepareEpoch.current += 1');
   expect(pay).toContain('preparePaymentRecipient(recipient, ARC_TESTNET_CHAIN_ID, sessionToken!)');
   expect(social).toContain('Open friend profile');
   expect(social).toContain('Friend options');
   expect(social).toContain('Confirm block');
   expect(social).toContain('Private messaging requires a verified, encrypted backend');
   expect(shell).toContain('<WalletAccountControls');
   expect(wallet).toContain('await social.signOut()');
   expect(wallet).toContain('await disconnectAsync()');
   const brand=file('components/brand/BrandLogo.tsx');
   expect(brand).toContain("import { TokenUSDC, TokenETH, TokenWETH, TokenWBTC, TokenUSDT, TokenDAI }");
   expect(brand).toContain('<TokenMark variant="branded"');
   expect(brand).not.toContain("@web3icons/react/dynamic");
   expect(brand).not.toContain('text="Y"');
 });
 it('integrates in full app without contaminating static Vercel financial preview',()=>{
   const app=file('App.tsx'),shell=file('components/layout/AppShell.tsx');
   const preview=file('preview/PreviewApp.tsx'), config=file('../vite.config.ts');
   expect(app).toContain('<UnifiedSocialProvider>');
   expect(app).toContain("case 'social':");
   expect(shell).toContain("label: 'Friends'");
   expect(shell).toContain('<NotificationBell');
   expect(preview).not.toContain('UnifiedSocialProvider');
   expect(preview).not.toContain('SocialPage');
   expect(config).toContain('input: previewHtml');
 });
});
