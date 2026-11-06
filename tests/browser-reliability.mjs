import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium, webkit } from '@playwright/test';
import { ownerPage, open } from '../skills/secure-key-handoff/scripts/handoff.mjs';
const root=await mkdtemp(join(tmpdir(),'handoff-reliability-'));
const source=resolve('skills/secure-key-handoff/scripts/handoff.mjs');
const engine=process.env.BROWSER_ENGINE==='webkit'?webkit:chromium;
const browser=await engine.launch(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{});
let checks=0;
try {
  // Run the installed-style symlink, not just the real source path.
  const linked=join(root,'installed.mjs'); await symlink(source,linked);
  const p=spawnSync(process.execPath,[linked,'prepare','--platform','apollo','--environment','test','--label','Apollo synthetic test','--private-dir',join(root,'private'),'--out',join(root,'page')],{encoding:'utf8'});
  assert.equal(p.status,0,p.stderr); const info=JSON.parse(p.stdout);
  const request=JSON.parse(await readFile(info.request,'utf8')); const key=await readFile(info.privateKey,'utf8'); checks++;
  for(const lang of ['zh','en']) for(const colorScheme of ['light','dark']) {
    const file=join(root,`${lang}-${colorScheme}.html`); await writeFile(file,ownerPage({...request,lang}));
    const page=await browser.newPage({colorScheme,viewport:colorScheme==='dark'?{width:390,height:844}:{width:1200,height:900}});
    const requests=[];page.on('request',r=>{if(r.url().startsWith('http'))requests.push(r.url())});
    await page.goto(pathToFileURL(file).href);
    if(process.env.HANDOFF_SCREENSHOTS){await page.screenshot({path:join(process.env.HANDOFF_SCREENSHOTS,`${lang}-${colorScheme}.png`),fullPage:true})}
    const colors=await page.locator('body').evaluate(e=>({fg:getComputedStyle(e).color,bg:getComputedStyle(e).backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth}));
    const lum=c=>{const a=c.match(/\d+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*a[0]+.7152*a[1]+.0722*a[2]};
    assert.ok((Math.max(lum(colors.fg),lum(colors.bg))+.05)/(Math.min(lum(colors.fg),lum(colors.bg))+.05)>=4.5,'text contrast'); assert.equal(colors.overflow,false,'no mobile horizontal overflow');
    const secret=lang==='en'?'Paste key':'粘贴密钥';const encrypt=lang==='en'?'Encrypt and download':'加密并下载';
    await page.getByLabel(secret,{exact:true}).fill('SYNTHETIC_ONLY_测试');
    const downloading=page.waitForEvent('download');await page.getByRole('button',{name:encrypt,exact:true}).click();const download=await downloading;
    const saved=join(root,`${lang}-${colorScheme}.json`);await download.saveAs(saved);
    assert.equal(await open(request,JSON.parse(await readFile(saved,'utf8')),key),'SYNTHETIC_ONLY_测试');
    assert.equal(await page.getByLabel(secret,{exact:true}).inputValue(),'');
    const retry=page.locator('#retry');const originalUrl=await retry.getAttribute('href');
    // Retry after the original one-second revocation window.
    await page.waitForTimeout(1200);const again=page.waitForEvent('download');await retry.click();await (await again).saveAs(join(root,'retry.json'));
    assert.equal(await open(request,JSON.parse(await readFile(join(root,'retry.json'),'utf8')),key),'SYNTHETIC_ONLY_测试');
    const cipher=JSON.parse(await page.locator('#ciphertext').inputValue());assert.equal(await open(request,cipher,key),'SYNTHETIC_ONLY_测试');
    assert.ok(!(await page.locator('#ciphertext').inputValue()).includes('SYNTHETIC_ONLY'));
    assert.match(await page.locator('output').innerText(),lang==='en'?/requested/:/已请求/);
    assert.deepEqual(requests,[]);checks++;await page.close();
  }
  for(const mode of ['blocked','throws']) {
    const page=await browser.newPage();await page.addInitScript(mode=>{
      HTMLAnchorElement.prototype.click=function(){if(mode==='throws')throw Error('simulated download failure')};
      Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('denied')}}});
    },mode);
    await page.goto(pathToFileURL(join(root,'page','owner.html')).href);
    await page.getByLabel('粘贴密钥',{exact:true}).fill('SYNTHETIC_RECOVERY_ONLY');await page.getByRole('button',{name:'加密并下载',exact:true}).click();
    await page.locator('#result').waitFor({state:'visible'});
    assert.equal(await open(request,JSON.parse(await page.locator('#ciphertext').inputValue()),key),'SYNTHETIC_RECOVERY_ONLY');
    assert.equal(await page.getByLabel('粘贴密钥',{exact:true}).inputValue(),'');
    await page.getByRole('button',{name:'复制加密结果',exact:true}).click();await page.getByText('自动复制不可用。',{exact:false}).waitFor();
    assert.ok(await page.locator('#ciphertext').evaluate(e=>e.selectionEnd===e.value.length&&e.selectionStart===0));
    assert.match(await page.locator('output').innerText(),mode==='throws'?/未能启动下载/:/已请求/);
    // A rejected new attempt must not leave the old result usable as its result.
    await page.getByLabel('粘贴密钥',{exact:true}).fill('sk_live_DEMO');await page.getByRole('button',{name:'加密并下载',exact:true}).click();
    assert.equal(await page.locator('#result').isVisible(),false);assert.equal(await page.locator('#ciphertext').inputValue(),'');
    checks++;await page.close();
  }
  console.log(`PASS: ${checks} reliability scenarios; symlink CLI, bilingual light/dark desktop/mobile, saved-file decrypt, delayed retry, blocked/thrown download, denied clipboard, stale result clearing`);
} finally {await browser.close();await rm(root,{recursive:true,force:true})}
