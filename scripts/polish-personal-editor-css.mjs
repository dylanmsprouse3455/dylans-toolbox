import fs from 'node:fs';

const path='app/toolbox.css';
const css=fs.readFileSync(path,'utf8');
const marker='/* Compact Personal item editor */';
const start=css.indexOf(marker);
if(start<0) throw new Error('Personal editor CSS marker not found');

const refined=`/* Compact Personal item editor */
.detail-sheet{
  max-height:74dvh;
  overflow-y:auto;
  overscroll-behavior:contain;
  -webkit-overflow-scrolling:touch;
  border-radius:28px 28px 0 0;
  padding:14px 28px calc(22px + env(safe-area-inset-bottom));
  background:#fff;
  scrollbar-width:none;
}
.detail-sheet::-webkit-scrollbar{display:none}
.detail-sheet::before{
  content:'';
  display:block;
  width:46px;
  height:5px;
  border-radius:999px;
  background:#d4dce8;
  margin:0 auto 12px;
}
.detail-sheet [data-slot=sheet-title]{
  font-size:1.2rem;
  line-height:1.2;
  letter-spacing:-.025em;
  margin:0 0 3px;
  padding-right:42px;
}
.detail-sheet [data-slot=sheet-description]{
  font-size:.84rem;
  line-height:1.35;
  color:#6b7890;
  margin:0 0 13px;
}
.detail-sheet>button:last-child{
  top:14px;
  right:20px;
}
.item-edit-form{
  display:grid!important;
  grid-template-columns:minmax(0,1fr) minmax(0,1fr);
  gap:10px 12px!important;
  padding-top:0;
}
.item-edit-form>label,
.item-edit-form>.form-grid,
.item-edit-form .form-grid>div{
  min-width:0;
}
.item-edit-form>label:not(:has(input[type=date])):not(:has(input[type=time])),
.item-edit-form>.form-grid{
  grid-column:1/-1;
}
.item-edit-form .field-label{
  font-size:.8rem;
  font-weight:650;
  line-height:1.15;
  color:#53627a;
  margin-bottom:5px;
}
.item-edit-form input[data-slot=input],
.item-edit-form [data-slot=select-trigger]{
  width:100%!important;
  min-width:0!important;
  max-width:100%;
  min-height:42px!important;
  height:42px!important;
  border-radius:13px;
  padding:0 12px!important;
  background:#fff;
  box-shadow:0 1px 2px #12213a0d;
}
.item-edit-form [data-slot=select-trigger]{
  display:flex;
  justify-content:space-between;
}
.item-edit-form textarea[data-slot=textarea]{
  min-height:72px!important;
  height:72px;
  max-height:120px;
  resize:vertical;
  border-radius:13px;
  line-height:1.35;
  padding:10px 12px!important;
  background:#fff;
  box-shadow:0 1px 2px #12213a0d;
}
.item-edit-form .form-grid{
  display:grid;
  grid-template-columns:minmax(0,1fr) minmax(0,1fr);
  gap:12px;
}
.item-edit-form label:has(input[type=date]),
.item-edit-form label:has(input[type=time]){
  min-width:0;
}
.item-edit-form label:has(input[type=date]) input,
.item-edit-form label:has(input[type=time]) input{
  width:100%!important;
  min-width:0!important;
  max-width:100%!important;
  min-height:42px!important;
  height:42px!important;
  padding:0 12px!important;
  font-size:.94rem!important;
  line-height:42px;
}
.item-edit-form>button{
  min-height:48px;
  margin-top:4px;
  border-radius:14px;
  font-size:1rem;
  font-weight:650;
}
.item-edit-form>button[type=submit]{grid-column:1/2}
.item-edit-form>button[type=button]{
  grid-column:2/3;
  background:#f3f6fb;
}
.item-edit-form input:disabled,
.item-edit-form button:disabled{opacity:.62}

@media(max-width:430px){
  .detail-sheet{
    max-height:76dvh;
    padding-left:24px;
    padding-right:24px;
  }
  .item-edit-form{gap:9px 10px!important}
  .item-edit-form .form-grid{gap:10px}
}
@media(max-width:360px){
  .detail-sheet{
    padding-left:18px;
    padding-right:18px;
  }
  .item-edit-form{gap:8px!important}
  .item-edit-form .form-grid{gap:8px}
  .item-edit-form .field-label{font-size:.76rem}
}
`;

fs.writeFileSync(path,css.slice(0,start)+refined+'\n');
