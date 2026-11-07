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
async function assertMenu(page,isMobile) {
  if(isMobile){
    const nav=page.getByRole('navigation',{name:'Primary navigation'});
    await nav.getByRole('button',{name:'More Veyra features'}).click();
    const sub=page.getByRole('region',{name:'More Veyra features'});
    assert(await sub.getByRole('button',{name:'Swap'}).isVisible());
    assert(await sub.getByRole('button',{name:'Bridge'}).isVisible());
    await sub.getByRole('button',{name:'Swap'}).click();
    assert.equal(await sub.count(),0,'Mobile More did not close after navigation');
  }else{
    const nav=page.getByRole('navigation',{name:'Main navigation'});
    await nav.locator('summary[aria-label="More features"]').click();
    assert(await nav.getByRole('button',{name:'Swap'}).isVisible());
    assert(await nav.getByRole('button',{name:'Bridge'}).isVisible());
    await nav.getByRole('button',{name:'Swap'}).click();
  }
  await page.getByRole('heading',{name:'Swap',exact:true}).waitFor();
  await noOverflow(page,isMobile?'mobile Swap':'desktop Swap');
  await snapshot(page,isMobile?'mobile-swap.png':'desktop-swap.png');
  if(isMobile){
    await page.getByRole('navigation',{name:'Primary navigation'})
      .getByRole('button',{name:'More Veyra features'}).click();
    await page.getByRole('region',{name:'More Veyra features'})
      .getByRole('button',{name:'Bridge'}).click();
  }else{
    const nav=page.getByRole('navigation',{name:'Main navigation'});
    await nav.locator('summary[aria-label="More features"]').click();
    await nav.getByRole('button',{name:'Bridge'}).click();
  }
  await page.getByRole('heading',{name:'Bridge',exact:true}).waitFor();
  await noOverflow(page,isMobile?'mobile Bridge':'desktop Bridge');
  await snapshot(page,isMobile?'mobile-bridge.png':'desktop-bridge.png');
}

async function runDesktop(browser){
  const {page,errors}=await makePage(browser,1440,900);
  try{
    const nav=page.getByRole('navigation',{name:'Main navigation'});
    for(const name of ['Home','Pay','Friends','Activity']){
      assert.equal(await nav.getByRole('button',{name,exact:true}).count(),1,
        'Desktop primary menu missing '+name);
    }
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

    await nav.getByRole('button',{name:'Friends',exact:true}).click();
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
    console.log('[browser] desktop Home, Pay, Friends, Activity, Unified, Swap, Bridge, tabs, width: PASS');
  }finally{await page.close();}
}
async function runMobile(browser,width,height){
  const {page,errors}=await makePage(browser,width,height,true);
  try{
    const nav=page.getByRole('navigation',{name:'Primary navigation'});
    for(const name of ['Home','Pay','Friends','Activity']){
      assert.equal(await nav.getByRole('button',{name,exact:true}).count(),1,
        'Mobile primary nav missing '+name);
    }
    const unified=page.locator('[aria-label="Unified Balance"]');
    assert(await unified.getByText('USDC Available').isVisible());
    assert(await unified.getByRole('button',{name:'Send to wallet'}).isVisible());
    await noOverflow(page,'mobile '+width+' Home');
    await snapshot(page,'mobile-'+width+'-home.png');
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
