import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
async function files(dir){
  return (await Promise.all((await readdir(dir,{withFileTypes:true})).map(async entry=>{
    const file=path.join(dir,entry.name);
    return entry.isDirectory()?files(file):[file.replaceAll('\\','/').replace(/^dist\//,'')];
  }))).flat();
}
const assets=(await files('dist')).filter(f=>f!=='sw.js').sort();
const hash=createHash('sha256');
for(const asset of assets)hash.update(await readFile('dist/'+asset));
const source=await readFile('public/sw.js','utf8');
await writeFile('dist/sw.js',source.replace('__BUILD_VERSION__',hash.digest('hex').slice(0,16)).replace(/const ASSETS=.*;/,'const ASSETS='+JSON.stringify(['./',...assets])+';'));
await writeFile('dist/.nojekyll','');
console.log(`PWA shell: ${assets.length} files precached.`);
