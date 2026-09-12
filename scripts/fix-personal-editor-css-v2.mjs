import { readFileSync, writeFileSync } from 'node:fs';

const path = 'app/toolbox.css';
const css = readFileSync(path, 'utf8');
const marker = '/* Compact Personal item editor */';
const index = css.indexOf(marker);
if (index < 0) throw new Error('Personal editor CSS marker not found');

const replacement = `/* Compact Personal item editor */
.detail-sheet{
  gap:0!important;
  max-height:calc(100dvh - 108px);
  overflow-y:auto;
  overscroll-behavior:contain;
  -webkit-overflow-scrolling:touch;
  border-radius:28px 28px 0 0;
  padding:30px 26px calc(20px + env(safe-area-inset-bottom));
  background:#fff;
  scrollbar-width:none;
}
.detail-sheet::-webkit-scrollbar{display:none}
.detail-sheet::before{
  content:'';
  position:absolute;
  top:10px;
  left:50%;
  transform:translateX(-50%);
  width:46px;
  height:5px;
  border-radius:999px;
  background:#d4dce8;
  pointer-events:none;
}
.detail-sheet [data-slot=sheet-title]{
  font-size:1.18rem;
  line-height:1.18;
  letter-spacing:-.025em;
  margin:0 0 2px!important;
  padding-right:44px;
}
.detail-sheet [data-slot=sheet-description]{
  font-size:.83rem;
  line-height:1.3;
  color:#6b7890;
  margin:0 0 14px!important;
}
.detail-sheet>button:last-child{
  top:16px;
  right:18px;
  min-width:38px;
  min-height:38px;
}
.item-edit-form{
  display:grid!important;
  grid-template-columns:minmax(0,1fr) minmax(0,1fr);
  column-gap:12px!important;
  row-gap:11px!important;
  padding:0!important;
  margin:0!important;
}
.item-edit-form>label,
.item-edit-form>.form-grid,
.item-edit-form .form-grid>div{
  min-width:0;
  margin:0!important;
}
.item-edit-form>label:not(:has(input[type=date])):not(:has(input[type=time])),
.item-edit-form>.form-grid{
  grid-column:1/-1;
}
.item-edit-form .field-label{
  display:block;
  font-size:.78rem;
  font-weight:650;
  line-height:1.1;
  color:#53627a;
  margin:0 0 5px!important;
}
.item-edit-form input[data-slot=input],
.item-edit-form textarea[data-slot=textarea],
.item-edit-form [data-slot=select-trigger]{
  box-sizing:border-box!important;
  width:100%!important;
  min-width:0!important;
  max-width:100%!important;
  border:1px solid #d8e0eb!important;
  background-color:#fff!important;
  box-shadow:0 1px 2px #12213a0b!important;
}
.item-edit-form input[data-slot=input],
.item-edit-form [data-slot=select-trigger]{
  min-height:44px!important;
  height:44px!important;
  border-radius:13px!important;
  padding:0 12px!important;
  font-size:.95rem!important;
}
.item-edit-form [data-slot=select-trigger]{
  display:flex!important;
  align-items:center!important;
  justify-content:space-between!important;
}
.item-edit-form textarea[data-slot=textarea]{
  min-height:78px!important;
  height:78px!important;
  max-height:130px!important;
  resize:vertical;
  border-radius:13px!important;
  line-height:1.35!important;
  padding:10px 12px!important;
  font-size:.95rem!important;
}
.item-edit-form .form-grid{
  display:grid!important;
  grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;
  gap:12px!important;
  width:100%!important;
}
.item-edit-form .form-grid>div,
.item-edit-form>label:has(input[type=date]),
.item-edit-form>label:has(input[type=time]){
  width:100%!important;
  min-width:0!important;
}
.item-edit-form input[type=date],
.item-edit-form input[type=time]{
  display:block!important;
  width:100%!important;
  min-width:0!important;
  max-width:100%!important;
  overflow:hidden;
  white-space:nowrap;
  font-size:.92rem!important;
  line-height:44px!important;
}
.item-edit-form input[type=date]::-webkit-date-and-time-value,
.item-edit-form input[type=time]::-webkit-date-and-time-value{
  text-align:left;
}
.item-edit-form [data-slot=select-trigger][aria-label=Area],
.item-edit-form [data-slot=select-trigger][aria-label=Type],
.item-edit-form [data-slot=select-trigger][aria-label=Importance],
.item-edit-form [data-slot=select-trigger][aria-label=Urgency],
.item-edit-form input[type=date],
.item-edit-form input[type=time]{
  padding-left:40px!important;
  background-repeat:no-repeat!important;
  background-position:13px center!important;
  background-size:18px 18px!important;
}
.item-edit-form [data-slot=select-trigger][aria-label=Area]{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%235d718f' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m3 11 9-8 9 8'/%3E%3Cpath d='M5 10v10h14V10'/%3E%3Cpath d='M9 20v-6h6v6'/%3E%3C/svg%3E")!important}
.item-edit-form [data-slot=select-trigger][aria-label=Type]{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%235d718f' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9'/%3E%3Cpath d='M10 21h4'/%3E%3C/svg%3E")!important}
.item-edit-form [data-slot=select-trigger][aria-label=Importance]{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%235d718f' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 22V4'/%3E%3Cpath d='M5 4h12l-2 4 2 4H5'/%3E%3C/svg%3E")!important}
.item-edit-form [data-slot=select-trigger][aria-label=Urgency]{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%235d718f' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m13 2-9 12h8l-1 8 9-12h-8z'/%3E%3C/svg%3E")!important}
.item-edit-form input[type=date]{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%235d718f' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='5' width='18' height='16' rx='2'/%3E%3Cpath d='M16 3v4M8 3v4M3 11h18'/%3E%3C/svg%3E")!important}
.item-edit-form input[type=time]{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%235d718f' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='9'/%3E%3Cpath d='M12 7v5l3 2'/%3E%3C/svg%3E")!important}
.item-edit-form>button{
  min-height:48px!important;
  height:48px!important;
  margin:2px 0 0!important;
  border-radius:14px!important;
  font-size:1rem!important;
  font-weight:650!important;
}
.item-edit-form>button[type=submit]{grid-column:1/2}
.item-edit-form>button[type=button]{
  grid-column:2/3;
  background:#f3f6fb!important;
}
.item-edit-form input:disabled,
.item-edit-form button:disabled{opacity:.62}

@media(max-width:430px){
  .detail-sheet{
    max-height:calc(100dvh - 96px);
    padding:29px 20px calc(18px + env(safe-area-inset-bottom));
  }
  .item-edit-form{
    column-gap:10px!important;
    row-gap:10px!important;
  }
  .item-edit-form .form-grid{gap:10px!important}
}
@media(max-width:360px){
  .detail-sheet{padding-left:16px;padding-right:16px}
  .item-edit-form{column-gap:8px!important}
  .item-edit-form .form-grid{gap:8px!important}
  .item-edit-form .field-label{font-size:.74rem}
  .item-edit-form input[data-slot=input],
  .item-edit-form [data-slot=select-trigger]{font-size:.88rem!important}
}
`;

writeFileSync(path, css.slice(0, index) + replacement);
