/** Browser-only, UNSIGNED Veyra Mainnet UI acceptance sweep.
 * Uses real Chromium (desktop/mobile) and exercises navigation, focus,
 * empty/error states and horizontal overflow. Network responses are mocked
 * so this is NOT a real authenticated or financial E2E claim.
 */
import fs from 'node:fs/promises';
import {chromium} from 'playwright';

const origin=process.env.VEYRA_QA_URL??'http://127.0.0.1:4173';
const output=process.env.VEYRA_QA_OUTPUT??'/tmp/veyra-browser-qa';
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const report=[];
async function run(name,viewport,mobile){
 const page=await browser.newPage({viewport,isMobile:mobile,deviceScaleFactor:1,
  hasTouch:mobile,colorScheme:'dark',reducedMotion:'reduce'});
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 // Never let QA initiate a production wallet/API call.
 await page.route('**/api/**',async route=>{
  await route.fulfill({status:503,contentType:'application/json',
   body:'{"ok":false,"error":"QA_BACKEND_UNAVAILABLE"}'});
 });
 async function check(stage){
  await page.waitForTimeout(350);
  const measured=await page.evaluate(()=>({
   width:innerWidth,document:document.documentElement.scrollWidth,
   body:document.body.scrollWidth,hasRoot:!!document.querySelector('#root'),
   active:document.activeElement?.tagName??'unknown',
  }));
  if(!measured.hasRoot)throw Error(name+': missing React root at '+stage);
  if(Math.max(measured.document,measured.body)>measured.width+8)
   throw Error(name+': horizontal overflow at '+stage+' '+JSON.stringify(measured));
  const path=output+'/'+name+'-'+stage+'.png';
  await page.screenshot({path,fullPage:false,animations:'disabled'});
  report.push({name,stage,pass:true,...measured,screenshot:path});
 }
 await page.goto(origin,{waitUntil:'domcontentloaded',timeout:30000});
 await page.locator('aside .display:visible, header .display:visible').first().waitFor({timeout:15000});
 await check('home');
 const steps=['Pay','Friends','Activity','Swap','Bridge'];
 for(const step of steps){
  if(mobile){
   const nav=page.getByRole('navigation',{name:'Primary navigation'});
   if(step==='Friends'||step==='Activity'){
    await nav.getByRole('button',{name:'More Veyra features'}).click();
    await page.getByRole('region',{name:'More Veyra features'}).getByRole('button',{name:step,exact:true}).click();
   }else await nav.getByRole('button',{name:step,exact:true}).click();
  }else{
   await page.locator('aside').getByRole('button',{name:step,exact:true}).click();
  }
  await check(step.toLowerCase());
 }
 // Users must be able to choose any Circle-listed network even without
 // a wallet. Unsupported routes never mount the executable Circle quote.
 const routePicker=page.locator('[aria-label="Bridge route"]');
 await routePicker.locator('button').nth(1).click();
 let dialog=page.getByRole('dialog',{name:'Select to network'});
 await dialog.getByRole('option',{name:/Arbitrum One/}).click();
 if(!await routePicker.getByText('Arbitrum One').isVisible())
  throw Error(name+': Arbitrum selection was not retained');
 let status=await page.locator('[aria-label="Bridge form"] [role="status"]').allTextContents();
 if(!status.some(x=>x.includes('live Veyra quote is not yet available')))
  throw Error(name+': unreviewed Arbitrum route must not show a signing quote');
 await check('bridge-arbitrum-selected');
 await routePicker.locator('button').first().click();
 dialog=page.getByRole('dialog',{name:'Select from network'});
 await dialog.getByRole('option',{name:/Solana/}).click();
 if(!await routePicker.getByText('Solana').isVisible())
  throw Error(name+': Solana network selection was blocked');
 status=await page.locator('[aria-label="Bridge form"] [role="status"]').allTextContents();
 if(!status.some(x=>x.includes('live Veyra quote is not yet available')))
  throw Error(name+': unsupported Solana route must not be quoted');
 await check('bridge-solana-selected');
 await routePicker.locator('button').first().click();
 dialog=page.getByRole('dialog',{name:'Select from network'});
 await dialog.getByRole('option',{name:/Arc/}).click();
 await routePicker.locator('button').nth(1).click();
 dialog=page.getByRole('dialog',{name:'Select to network'});
 await dialog.getByRole('option',{name:/Base/}).click();
 status=await page.locator('[aria-label="Bridge form"] [role="status"]').allTextContents();
 if(status.some(x=>x.includes('live Veyra quote is not yet available')))
  throw Error(name+': integrated Arc/Base route did not recover after browsing');
 await check('bridge-base-restored');
 if(!mobile){
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await check('keyboard');
 }else{
  await page.getByRole('navigation',{name:'Primary navigation'}).getByRole('button',{name:'Pay'}).click();
  await page.keyboard.press('Tab');
  await check('keyboard-focus');
 }
 if(errors.length)throw Error(name+' browser exceptions: '+errors.join('; ').slice(0,1500));
 await page.close();
}
try{
 await run('desktop',{width:1366,height:850},false);
 await run('small-desktop',{width:1024,height:768},false);
 await run('mobile',{width:390,height:844},true);
 await run('small-mobile',{width:320,height:680},true);
 await fs.writeFile(output+'/report.json',JSON.stringify({passed:true,checks:report},null,2));
 console.log('VEYRA_REAL_BROWSER_UI_SMOKE_PASS '+report.length+' screenshots='+output);
}catch(e){
 await fs.writeFile(output+'/report.json',JSON.stringify({passed:false,error:String(e),checks:report},null,2));
 console.error('VEYRA_REAL_BROWSER_UI_SMOKE_FAILED',e);
 process.exitCode=1;
}finally{await browser.close();}
