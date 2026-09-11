// Vite's optional network-drive probe throws synchronously when a Windows
// sandbox disallows cmd.exe. Local-drive builds do not need that optimization.
import {readFileSync,writeFileSync} from 'node:fs';
if(process.platform==='win32'){
  const path=new URL('../node_modules/vite/dist/node/chunks/node.js',import.meta.url);
  let source=readFileSync(path,'utf8');
  const old='function optimizeSafeRealPathSync() {';
  const fix='function optimizeSafeRealPathSync() {\n\tif (process.env.TOOLBOX_LOCAL_DRIVE_ONLY === "1") { safeRealpathSync = fs.realpathSync.native; return; }';
  if(!source.includes('TOOLBOX_LOCAL_DRIVE_ONLY'))writeFileSync(path,source.replace(old,fix));
  process.env.TOOLBOX_LOCAL_DRIVE_ONLY='1';
}
