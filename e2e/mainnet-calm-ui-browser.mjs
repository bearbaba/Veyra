/**
 * Browser regression for Veyra Mainnet consumer UI.
 * Runs ONLY against a locally built copy of the reviewed commit.
 * Disconnected/mock-only: NEVER signs or transmits financial transactions.
 */
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';

const {chromium} = await import(process.env.VEYRA_PLAYWRIGHT_MODULE
  || 'file:///tmp/veyra-browser/node_modules/playwright/index.mjs');
const BASE = process.env.VEYRA_BROWSER_URL || 'http://127.0.0.1:4173';
await mkdir('e2e-results', {recursive:true});

async function makePage(browser,width,height,phone=false) {
  const page = await browser.newPage({
    viewport:{width,height},
    ...(phone?{isMobile:true,hasTouch:true,deviceScaleFactor:1}:{}),
    reducedMotion:'reduce',
  });
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  // All wallet actions are absent; provider networks are nonessential to navigation.
  await page.route(/fonts\.(googleapis|gstatic)\.com/,route=>route.abort());
  await page.goto(BASE,{waitUntil:'domcontentloaded',timeout:30_000});
  await page.getByRole('heading',{name:/Your money,/}).waitFor({timeout:20_000});
  return {page,errors};
}
async function noOverflow(page,label) {
  const rect=await page.evaluate(()=>({
    viewport:document.documentElement.clientWidth,
    scroll:document.documentElement.scrollWidth,
    screen:window.innerWidth,
  }));
  assert(rect.scroll<=rect.viewport+2,
    label+' horizontal overflow: '+JSON.stringify(rect));
}
async function snapshot(page,filename) {
  await page.screenshot({path:'e2e-results/'+filename,fullPage:true,animations:'disabled'});
}
async function assertSideBySide(page,selector,label) {
  const buttons=page.locator(selector).getByRole('button');
  assert.equal(await buttons.count(),3,label+' needs From, Reverse, To');
  const from=await buttons.first().boundingBox();
  const to=await buttons.last().boundingBox();
  assert(from&&to,label+' pickers missing');
  assert(Math.abs(from.y-to.y)<=4,label+' source and destination must share a row');
  assert(to.x>=from.x+from.width,label+' To must appear right of From');
  assert(from.width>=75&&to.width>=75,label+' picker too narrow: '+JSON.stringify({from,to}));
}
async function assertMenu(page,isMobile) {
  const nav=isMobile?page.getByRole('navigation',{name:'Primary navigation'}):page.locator('aside');
  await nav.getByRole('button',{name:'Swap',exact:true}).click();
  await page.getByRole('heading',{name:'Swap',exact:true}).waitFor();
  const swapRoute=page.locator('[aria-label="Swap token route"]');
  assert(await swapRoute.getByRole('button',{name:'Choose token to pay'}).isVisible());
  assert(await swapRoute.getByRole('button',{name:'Choose token to receive'}).isVisible());
  await assertSideBySide(page,'[aria-label="Swap token route"]',(isMobile?'mobile':'desktop')+' Swap');
  await noOverflow(page,isMobile?'mobile Swap':'desktop Swap');
  await snapshot(page,isMobile?'mobile-swap.png':'desktop-swap.png');

  await nav.getByRole('button',{name:'Bridge',exact:true}).click();
  await page.getByRole('heading',{name:'Bridge',exact:true}).waitFor();
  await assertSideBySide(page,'[aria-label="Bridge route"]',(isMobile?'mobile':'desktop')+' Bridge');
  await noOverflow(page,isMobile?'mobile Bridge':'desktop Bridge');
  await snapshot(page,isMobile?'mobile-bridge.png':'desktop-bridge.png');
}

async function runDesktop(browser){
  const {page,errors}=await makePage(browser,1440,900);
  try{
    const nav=page.locator('aside');
    const sidebarRect=await nav.boundingBox();
    assert(sidebarRect&&Math.abs(sidebarRect.width-208)<2,
      'Pre-92 desktop sidebar width 208px not restored: '+JSON.stringify(sidebarRect));
    for(const name of ['Home','Friends','Pay','Swap','Bridge','Activity']){
      assert.equal(await nav.getByRole('button',{name,exact:true}).count(),1,
        'Desktop menu missing '+name);
    }
    const primaryLabels=(await nav.locator(':scope > button').allTextContents()).map(x=>x.trim());
    assert.deepEqual(primaryLabels.slice(0,5),['Home','Friends','Pay','Swap','Bridge'],
      'Desktop actions must follow the reviewed financial priority');
    assert(await nav.getByRole('button',{name:'Activity',exact:true}).isEnabled(),
      'Activity is a real History page, never Soon');
    assert(await page.locator('.veyra-headline-accent').isVisible(),'Original gradient hero missing');
    const unified=page.locator('[aria-label="Unified Balance"]');
    assert(await unified.isVisible(),'Unified balance hidden');
    assert(await unified.getByText('USDC Available').isVisible(),'Unified Available hidden');
    assert(await unified.getByRole('button',{name:'Add USDC'}).isVisible());
    assert(await unified.getByRole('button',{name:'Send to wallet'}).isVisible());
    assert(await unified.getByRole('button',{name:'Show Unified details'}).isVisible());
    await unified.getByRole('button',{name:'Show Unified details'}).click();
    assert.equal(await unified.getByRole('button',{name:'Hide Unified details'}).getAttribute('aria-expanded'),'true');
    await unified.getByRole('button',{name:'Hide Unified details'}).click();
    await noOverflow(page,'desktop Home');
    await snapshot(page,'desktop-home.png');

    await nav.getByRole('button',{name:'Pay',exact:true}).click();
    await page.getByRole('heading',{name:'Pay',exact:true}).waitFor();
    assert.equal(await page.getByText('Direct USDC · pilot').count(),0,'Prohibited Direct payment entry');
    await noOverflow(page,'desktop Pay');
    await snapshot(page,'desktop-pay.png');

    await nav.getByRole('button',{name:'More Veyra features'}).click();
    const more=page.getByRole('region',{name:'More Veyra features'});
    assert.equal(await more.locator('button').first().getAttribute('aria-label'),'Activity',
      'Activity must be first in mobile More');
    assert(await more.getByRole('button',{name:'Activity',exact:true}).isEnabled());
    await more.getByRole('button',{name:'Friends',exact:true}).click();
    assert.equal(await more.count(),0,'Mobile More must close after navigation');
    await page.getByRole('heading',{name:'Friends',exact:true}).waitFor();
    await noOverflow(page,'desktop Friends');
    await snapshot(page,'desktop-friends.png');

    await nav.getByRole('button',{name:'Activity',exact:true}).click();
    await noOverflow(page,'desktop Activity');
    await assertMenu(page,false);
    await nav.getByRole('button',{name:'Home',exact:true}).click();
    await page.getByRole('heading',{name:/Your money,/}).waitFor();
    assert.equal(await page.getByRole('heading',{name:'Pay',exact:true}).count(),0,'Tab change retained wrong view');
    assert.deepEqual(errors,[],'Browser JS errors: '+errors.join(' | '));
    console.log('[browser] desktop original 208px sidebar + direct Swap/Bridge, Home/Pay/Friends/Unified, tabs, width: PASS');
  }finally{await page.close();}
}
async function runMobile(browser,width,height){
  const {page,errors}=await makePage(browser,width,height,true);
  try{
    const nav=page.getByRole('navigation',{name:'Primary navigation'});
    for(const name of ['Home','Pay','Swap','Bridge']){
      assert.equal(await nav.getByRole('button',{name,exact:true}).count(),1,
        'Mobile primary nav missing '+name);
    }
    assert.equal(await nav.getByRole('button',{name:'Friends',exact:true}).count(),0);
    assert.equal(await nav.getByRole('button',{name:'Activity',exact:true}).count(),0);
    assert.equal(await nav.getByRole('button',{name:'More Veyra features'}).count(),1);
    const unified=page.locator('[aria-label="Unified Balance"]');
    assert(await unified.getByText('USDC Available').isVisible());
    assert(await unified.getByRole('button',{name:'Send to wallet'}).isVisible());
    await noOverflow(page,'mobile '+width+' Home');
    await snapshot(page,'mobile-'+width+'-home.png');
    assert.equal(await page.locator('aside').isVisible(),false,
      'Desktop sidebar visible on a phone');
    await nav.getByRole('button',{name:'Pay',exact:true}).click();
    await page.getByRole('heading',{name:'Pay',exact:true}).waitFor();
    await noOverflow(page,'mobile '+width+' Pay');
    await snapshot(page,'mobile-'+width+'-pay.png');
    await nav.getByRole('button',{name:'Friends',exact:true}).click();
    await page.getByRole('heading',{name:'Friends',exact:true}).waitFor();
    await noOverflow(page,'mobile '+width+' Friends');
    await snapshot(page,'mobile-'+width+'-friends.png');
    await assertMenu(page,true);
    await nav.getByRole('button',{name:'Home',exact:true}).click();
    await page.getByRole('heading',{name:/Your money,/}).waitFor();
    // Simulate reduced visual viewport from mobile keyboard. Controls must remain scrollable.
    await page.setViewportSize({width,height:Math.min(height,540)});
    await page.getByRole('navigation',{name:'Primary navigation'}).getByRole('button',{name:'Pay',exact:true}).click();
    await page.getByRole('heading',{name:'Pay',exact:true}).waitFor();
    await noOverflow(page,'mobile '+width+' shortened viewport');
    const top=await page.getByRole('navigation',{name:'Primary navigation'}).boundingBox();
    assert(top&&top.y>0,'Mobile navigation missing in shortened viewport');
    assert.deepEqual(errors,[],'Browser JS errors: '+errors.join(' | '));
    console.log('[browser] mobile '+width+'px Home, Pay, Friends, More, Swap/Bridge, keyboard-height, tabs: PASS');
  }finally{await page.close();}
}
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
  await runDesktop(browser);
  await runMobile(browser,390,844);
  await runMobile(browser,320,700);
  console.log('[browser] PASS: disconnected wallet only; no financial signing, no live recipient/chat E2E.');
}finally{await browser.close();}
