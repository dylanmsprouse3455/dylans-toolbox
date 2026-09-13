from pathlib import Path
p=Path('tests/conversation.test.ts')
text=p.read_text()
old="const patch=(id:string,version:string,extra:object={})=>({item_id:id,expected_updated_at:version,status:null,change_due:false,due_at:null,due_date:null,title:null,content:null,area:null,change_dependency:false,depends_on_id:null,...extra});"
new="const patch=(id:string,version:string,extra:object={})=>({item_id:id,expected_updated_at:version,status:null,change_due:false,due_at:null,due_date:null,title:null,content:null,area:null,change_dependency:false,depends_on_id:null,change_waiting:false,workflow_state:null,waiting_on:null,follow_up_at:null,follow_up_date:null,change_highlighted:false,highlighted:null,...extra});"
if old not in text: raise SystemExit('conversation patch helper not found')
p.write_text(text.replace(old,new,1))
