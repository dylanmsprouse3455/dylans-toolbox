from pathlib import Path

def replace(path, old, new):
    p=Path(path); text=p.read_text()
    if old not in text: raise SystemExit(f'pattern missing in {path}: {old[:120]}')
    p.write_text(text.replace(old,new,1))

replace('lib/items.ts',"item.follow_up_date?new Date(item.follow_up_date+'T23:59:59').getTime():Infinity","item.follow_up_date?new Date(item.follow_up_date+'T00:00:00').getTime():Infinity")
replace('app/toolbox.tsx',"const wake=()=>{if(document.visibilityState==='visible')void sync();};","const wake=()=>{if(document.visibilityState==='visible')void sync().finally(()=>void runOverdueAutopilot());};")
replace('supabase/personal-attention-v2.sql',"create or replace function public.toolbox_record_personal_revision() returns trigger language plpgsql security definer set search_path='' as $$\nbegin\n  if old.area<>'Work'","create or replace function public.toolbox_record_personal_revision() returns trigger language plpgsql security definer set search_path='' as $$\nbegin\n  if current_setting('toolbox.skip_revision',true)='1' then return new; end if;\n  if old.area<>'Work'")
replace('supabase/personal-attention-v2.sql',"  snap=revision.snapshot;\n  update public.items set","  snap=revision.snapshot;\n  perform set_config('toolbox.skip_revision','1',true);\n  update public.items set")
replace('supabase/personal-attention-v2.sql',"  where id=item_uuid and user_id=owner_id and area<>'Work';\n  delete from public.personal_item_revisions where id=revision.id","  where id=item_uuid and user_id=owner_id and area<>'Work';\n  perform set_config('toolbox.skip_revision','0',true);\n  delete from public.personal_item_revisions where id=revision.id")

p=Path('tests/personal-attention-v2.test.ts'); text=p.read_text()
text=text.replace("  const due={...waiting,follow_up_date:'2026-09-12'};\n  assert.equal(attention([due],now)[0]?.id,due.id);","  const due={...waiting,follow_up_date:'2026-09-13'};\n  assert.equal(attention([due],now)[0]?.id,due.id);")
text=text.replace("assert.match(sql,/toolbox_undo_personal_item/);assert.match(sql,/'version',3/);","assert.match(sql,/toolbox_undo_personal_item/);assert.match(sql,/toolbox.skip_revision/);assert.match(sql,/'version',3/);")
p.write_text(text)
