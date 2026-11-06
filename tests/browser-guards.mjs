import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=await mkdtemp(join(tmpdir(),'handoff-browser-guards-'));
const source=resolve('skills/secure-key-handoff/scripts/handoff.mjs');const original=await readFile(source,'utf8');
try {
  await mkdir(join(root,'skills/secure-key-handoff/scripts'),{recursive:true});await mkdir(join(root,'tests'));
  await writeFile(join(root,'package.json'),'{"type":"module"}');await symlink(resolve('node_modules'),join(root,'node_modules'),'junction');
  await copyFile(resolve('tests/browser-reliability.mjs'),join(root,'tests/browser-reliability.mjs'));
  const target=join(root,'skills/secure-key-handoff/scripts/handoff.mjs');
  for(const [name,before,after] of [
    ['unreadable text','body{background:#fff;','body{background:#173449;'],
    ['denied-clipboard recovery','cipher.focus();cipher.select();','cipher.focus();'],
  ]) {
    assert.equal(original.split(before).length,2);await writeFile(target,original.replace(before,after));
    const result=spawnSync(process.execPath,['tests/browser-reliability.mjs'],{cwd:root,encoding:'utf8',timeout:60000});
    assert.notEqual(result.status,0);assert.match(result.stderr,/AssertionError/,'must fail a behavioral assertion, not infrastructure');
    console.log(`PASS: injected defect detected: ${name}`);
  }
  assert.equal(await readFile(source,'utf8'),original);
} finally {await rm(root,{recursive:true,force:true})}
