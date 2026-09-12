import fs from 'node:fs';

const tsxPath='app/toolbox.tsx';
const cssPath='app/toolbox.css';
let tsx=fs.readFileSync(tsxPath,'utf8');
const oldForm='<form className="stack" onSubmit={e=>void saveEdit(e)}>';
const newForm='<form className="stack item-edit-form" onSubmit={e=>void saveEdit(e)}>';
if(tsx.includes(oldForm))tsx=tsx.replace(oldForm,newForm);
else if(!tsx.includes(newForm))throw new Error('Could not find Personal item edit form');
tsx=tsx.replace('Time (optional, your local time)','Time');
fs.writeFileSync(tsxPath,tsx);

let css=fs.readFileSync(cssPath,'utf8');
const marker='/* Compact Personal item editor */';
if(!css.includes(marker)){
css+=`\n\n${marker}\n.detail-sheet{max-height:82dvh;overscroll-behavior:contain;border-radius:22px 22px 0 0;padding:18px 18px calc(18px + env(safe-area-inset-bottom));scrollbar-width:none}.detail-sheet::-webkit-scrollbar{display:none}.detail-sheet::before{content:'';display:block;width:38px;height:4px;border-radius:999px;background:#d7dfeb;margin:-5px auto 11px}.detail-sheet [data-slot=sheet-title]{font-size:1.16rem;line-height:1.25;letter-spacing:-.02em;margin:0 0 2px;padding-right:42px}.detail-sheet [data-slot=sheet-description]{font-size:.82rem;line-height:1.35;color:#6a7890;margin:0 0 14px}.detail-sheet>button:last-child{top:12px;right:10px}.item-edit-form{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:11px 10px!important;padding-top:1px}.item-edit-form>label:not(:has(input[type=date])):not(:has(input[type=time])),.item-edit-form>.form-grid{grid-column:1/-1}.item-edit-form .field-label{font-size:.78rem;font-weight:650;line-height:1.2;color:#52627a;margin-bottom:5px}.item-edit-form input[data-slot=input],.item-edit-form [data-slot=select-trigger]{min-height:44px;height:44px;border-radius:12px;padding:8px 11px;background:#fff}.item-edit-form textarea[data-slot=textarea]{min-height:88px;max-height:150px;resize:vertical;border-radius:12px;line-height:1.42;padding:11px 12px;background:#fff}.item-edit-form .form-grid{gap:10px}.item-edit-form>button{margin-top:2px;min-height:46px}.item-edit-form>button[type=submit]{grid-column:1/2}.item-edit-form>button[type=button]{grid-column:2/3;background:#f3f6fa}.item-edit-form input:disabled,.item-edit-form button:disabled{opacity:.62}.item-edit-form label:has(input[type=date]),.item-edit-form label:has(input[type=time]){min-width:0}.item-edit-form label:has(input[type=date]) input,.item-edit-form label:has(input[type=time]) input{font-size:.95rem!important}\n@media(max-width:360px){.detail-sheet{padding-left:14px;padding-right:14px}.item-edit-form{gap:10px 8px}.item-edit-form .form-grid{gap:8px}.item-edit-form .field-label{font-size:.75rem}}\n`;
fs.writeFileSync(cssPath,css);
}

for(const path of ['scripts/patch-personal-edit-layout.mjs','.github/workflows/patch-personal-edit-layout.yml']){
  if(fs.existsSync(path))fs.rmSync(path);
}
