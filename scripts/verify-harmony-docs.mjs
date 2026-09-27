import {readFile, readdir, access} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
const files=['README.md','README.zh-CN.md','docs/README.md','docs/HARMONYOS_DEVICE_AUTOMATION.md',...(await readdir('docs/harmony')).filter(name=>name.endsWith('.md')).map(name=>`docs/harmony/${name}`)];
for(const file of files) {
 const source=await readFile(file,'utf8');
 for(const match of source.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
  const target=match[1].split('#')[0]; if(!target||/^[a-z]+:/i.test(target))continue;
  await access(resolve(dirname(file),decodeURIComponent(target))).catch(()=>{throw new Error(`Dead local link in ${file}: ${target}`);});
 }
}
const pkg=JSON.parse(await readFile('package.json','utf8'));
if(!(await readFile('README.md','utf8')).includes('`'+pkg.version+'`'))throw new Error('README source version is stale');
if(/\d+\.\d+\.\d+/.test(await readFile('README.zh-CN.md','utf8')))throw new Error('Chinese redirect must not duplicate a version');
console.log(`Verified ${files.length} current documentation entry points`);
