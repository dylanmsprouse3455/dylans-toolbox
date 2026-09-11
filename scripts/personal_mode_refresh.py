from pathlib import Path
import re


def replace_once(path, old, new):
    p=Path(path); text=p.read_text()
    if old not in text:
        raise SystemExit(f'Missing target in {path}: {old[:140]}')
    p.write_text(text.replace(old,new,1))

# ---- item model / helpers ----
p=Path('lib/items.ts'); text=p.read_text()
text=text.replace("export const AREAS = ['Work','Home','Money','Personal','People','Projects','Ideas','Inbox'] as const;", "export const AREAS = ['Work','Home','Money','Personal','People','Projects','Ideas','Inbox'] as const;\nexport const PERSONAL_AREAS = ['Home','Money','Personal','People','Projects','Ideas','Inbox'] as const;")
text=text.replace("  capture_id: string | null; created_at: string; updated_at: string;", "  capture_id: string | null; created_at: string; updated_at: string;\n  completed_at?: string | null; last_opened_at?: string | null;")
text += "\nexport function unopenedForDay(item:Pick<Item,'last_opened_at'|'created_at'|'status'|'type'>,now=Date.now()){\n  if(item.status!=='active'||!actionable(item))return false;\n  const seen=Date.parse(item.last_opened_at||item.created_at);\n  return Number.isFinite(seen)&&now-seen>=24*3600000;\n}\nexport function completionMoment(item:Pick<Item,'completed_at'|'updated_at'>){return item.completed_at||item.updated_at;}\nexport function completionDayKey(item:Pick<Item,'completed_at'|'updated_at'>){const d=new Date(completionMoment(item));return Number.isNaN(d.getTime())?'unknown':d.toISOString().slice(0,10);}\nexport function completionDayLabel(item:Pick<Item,'completed_at'|'updated_at'>,now=new Date()){\n  const d=new Date(completionMoment(item));if(Number.isNaN(d.getTime()))return 'Earlier';\n  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate()),day=new Date(d.getFullYear(),d.getMonth(),d.getDate());\n  const diff=Math.round((today.getTime()-day.getTime())/86400000);\n  if(diff===0)return 'Today';if(diff===1)return 'Yesterday';\n  return d.toLocaleDateString([],{weekday:'long',month:'short',day:'numeric',year:d.getFullYear()!==now.getFullYear()?'numeric':undefined});\n}\n"
p.write_text(text)

# ---- personal reasoning rules ----
p=Path('lib/capture-schema.ts'); text=p.read_text()
needle="    'Use concise titles. Store supporting details in content. Create subtasks only for explicit related steps, only under a task; do not create speculative steps.',"
replacement="    'Use concise titles. Store supporting details in content. Create subtasks only for explicit related steps, only under a task; do not create speculative steps.',\n    'CONNECTED ACTIONS: When the user explicitly describes multiple actions that belong to one outcome or one action is a prerequisite for another, group them under one concise parent task and put the explicit steps in practical execution order. Example: get cat litter and then clean/refill the cat boxes should surface the litter/shopping step before the cleaning/refill step. Do not invent stores, purchases, or errands the user did not state.',\n    'GENERAL NOTES: Thoughts that are not actions now but may be useful or relevant later should be stored as note or reference items, not forced into To Do.',"
if needle not in text: raise SystemExit('capture instruction target missing')
text=text.replace(needle,replacement,1)
needle="  if(workspace==='work')base.push("
insert="  if(workspace==='personal')base.push(\n    'PERSONAL WORKSPACE: Keep Work completely separate. Never create, update, move, or return an item in area Work from Personal mode. If the utterance is only a work matter, make no item changes and briefly tell Dylan to put it in Work mode. Personal areas are Home, Money, Personal, People, Projects, Ideas, and Inbox.'\n  );\n  if(workspace==='work')base.push("
if needle not in text: raise SystemExit('workspace target missing')
text=text.replace(needle,insert,1)
p.write_text(text)

# ---- hard Personal/Work separation + AI-channel context ----
p=Path('lib/conversation.ts'); text=p.read_text()
text=text.replace("const columns='id,type,title,content,area,status,importance,urgency,due_at,due_date,parent_id,updated_at';", "const columns='id,type,title,content,area,status,importance,urgency,due_at,due_date,parent_id,updated_at,completed_at,last_opened_at';")
text=text.replace("  return workspace==='work'?managed:!managed;", "  return workspace==='work'?managed:item.area!=='Work';")
text=text.replace("export async function conversationContext(client:SupabaseClient,text:string,focusId?:string,replyTo?:string,workspace:'personal'|'work'='personal'){", "export async function conversationContext(client:SupabaseClient,text:string,focusId?:string,replyTo?:string,workspace:'personal'|'work'='personal',channel:'capture'|'ai'='capture'){")
text=text.replace("  if(workspace==='work')recentQuery=recentQuery.eq('area','Work');", "  if(workspace==='work')recentQuery=recentQuery.eq('area','Work');else recentQuery=recentQuery.neq('area','Work');",1)
text=text.replace("  let historyQuery=client.from('items').select('id,content,source_text,turn_result,area').eq('type','capture').eq('status','processed');\n  if(workspace==='work')historyQuery=historyQuery.eq('area','Work');", "  let historyQuery=client.from('items').select('id,title,content,source_text,turn_result,area').eq('type','capture').eq('status','processed');\n  if(workspace==='work')historyQuery=historyQuery.eq('area','Work');else historyQuery=historyQuery.neq('area','Work');\n  if(workspace==='personal'&&channel==='ai')historyQuery=historyQuery.eq('title','AI conversation');")
text=text.replace("    let priorQuery=client.from('items').select('id,content,source_text,turn_result,area').eq('id',replyTo).eq('type','capture').eq('status','processed');", "    let priorQuery=client.from('items').select('id,title,content,source_text,turn_result,area').eq('id',replyTo).eq('type','capture').eq('status','processed');")
# Remaining personal candidate searches must exclude all Work rows.
text=text.replace("    if(workspace==='work')foundQuery=foundQuery.eq('area','Work');", "    if(workspace==='work')foundQuery=foundQuery.eq('area','Work');else foundQuery=foundQuery.neq('area','Work');")
p.write_text(text)

# ---- capture channel + enforcement ----
p=Path('lib/capture-handler.ts'); text=p.read_text()
text=text.replace("    let workspace:'personal'|'work'=form.get('workspace')==='work'?'work':'personal';", "    let workspace:'personal'|'work'=form.get('workspace')==='work'?'work':'personal';\n    let channel:'capture'|'ai'=form.get('channel')==='ai'?'ai':'capture';")
text=text.replace(".select('id,status,source_text,turn_result,area')", ".select('id,status,source_text,turn_result,area,title,content')",1)
text=text.replace("    if(existing?.area==='Work')workspace='work';", "    if(existing?.area==='Work')workspace='work';\n    if(existing?.title==='AI conversation')channel='ai';")
text=text.replace("type:'capture',title:'Raw capture',content:JSON.stringify({...contextIds.data,workspace})", "type:'capture',title:channel==='ai'?'AI conversation':'Raw capture',content:JSON.stringify({...contextIds.data,workspace,channel})")
text=text.replace("    const context=await conversationContext(client,text,contextIds.data.focus_id,contextIds.data.reply_to,workspace);", "    const context=await conversationContext(client,text,contextIds.data.focus_id,contextIds.data.reply_to,workspace,channel);")
marker="    if(workspace==='work'){\n      for(const item of organized.items){"
insert="    if(workspace==='personal'){\n      const removed=organized.items.filter(item=>item.area==='Work').length+organized.updates.filter(change=>context.candidates.get(change.item_id)?.area==='Work'||change.area==='Work').length;\n      organized.items=organized.items.filter(item=>item.area!=='Work');\n      organized.updates=organized.updates.filter(change=>context.candidates.get(change.item_id)?.area!=='Work'&&change.area!=='Work');\n      if(removed)organized.reply=(organized.items.length||organized.updates.length?'I kept the Work part out of Personal and handled the personal part.':'That belongs in Work mode, so I kept it out of Personal.');\n    }\n    if(workspace==='work'){\n      for(const item of organized.items){"
if marker not in text: raise SystemExit('handler workspace marker missing')
text=text.replace(marker,insert,1)
p.write_text(text)

# ---- local capture channel ----
p=Path('lib/local.ts'); text=p.read_text()
text=text.replace("export type Capture={id:string;user_id:string;text?:string;audio?:Blob;captured_at:string;time_zone:string;error?:string;focus_id?:string;reply_to?:string};", "export type Capture={id:string;user_id:string;text?:string;audio?:Blob;captured_at:string;time_zone:string;error?:string;focus_id?:string;reply_to?:string;channel?:'capture'|'ai'};")
p.write_text(text)

# ---- Supabase personal filtering: every Work row stays out of Personal ----
p=Path('lib/supabase.ts'); text=p.read_text()
text=text.replace("          const items=entry.items.filter((item:unknown)=>!managedWorkRow(item));", "          const items=entry.items.filter((item:unknown)=>!(item&&typeof item==='object'&&(item as {area?:unknown}).area==='Work'));")
text=text.replace("    const filtered=data.filter((item:unknown)=>workspace==='work'?(managedWorkRow(item)||workWizardReceiptRow(item)):!managedWorkRow(item));", "    const filtered=data.filter((item:unknown)=>workspace==='work'?(managedWorkRow(item)||workWizardReceiptRow(item)):!(item&&typeof item==='object'&&(item as {area?:unknown}).area==='Work'));")
p.write_text(text)

# ---- Personal UI ----
p=Path('app/toolbox.tsx'); text=p.read_text()
text=text.replace("MessageCircle,X", "MessageSquareText,Search,StickyNote,X")
text=text.replace("AREAS,actionable,attention,dueLabel,dueTime,quadrant,type Area,type Item,type ItemType", "AREAS,PERSONAL_AREAS,actionable,attention,dueLabel,dueTime,quadrant,unopenedForDay,completionDayKey,completionDayLabel,completionMoment,type Area,type Item,type ItemType")
# Add AI history type.
text=text.replace("type SpeechRecognitionWindow=Window&{SpeechRecognition?:new()=>SpeechRecognitionLike;webkitSpeechRecognition?:new()=>SpeechRecognitionLike};", "type SpeechRecognitionWindow=Window&{SpeechRecognition?:new()=>SpeechRecognitionLike;webkitSpeechRecognition?:new()=>SpeechRecognitionLike};\ntype AiHistoryRow={id:string;source_text:string;turn_result:{reply?:string;needs_clarification?:boolean}|null;created_at:string};")
# Replace bubble state with Personal AI/search state.
text=text.replace("  const [orbitOpen,setOrbitOpen]=useState(false),[orbitUnread,setOrbitUnread]=useState(false);", "  const [aiDraft,setAiDraft]=useState(''),[aiHistory,setAiHistory]=useState<AiHistoryRow[]>([]),[completedQuery,setCompletedQuery]=useState('');")
text=text.replace("  const reviewContext=useRef<{captured_at:string;focus_id?:string;reply_to?:string}|null>(null);", "  const reviewContext=useRef<{captured_at:string;focus_id?:string;reply_to?:string;channel?:'capture'|'ai'}|null>(null);")
# load AI conversation history
needle="  const refresh=useCallback(async()=>{"
ai_loader="  const loadAiHistory=useCallback(async()=>{\n    const client=clientRef.current,owner=sessionRef.current?.user.id;if(!client||!owner||!navigator.onLine)return;\n    const result=await client.from('items').select('id,source_text,turn_result,created_at').eq('user_id',owner).eq('type','capture').eq('title','AI conversation').eq('status','processed').order('created_at',{ascending:false}).limit(30);\n    if(result.error)throw result.error;setAiHistory(((result.data??[]) as AiHistoryRow[]).reverse());\n  },[]);\n  const refresh=useCallback(async()=>{"
if needle not in text: raise SystemExit('refresh marker missing')
text=text.replace(needle,ai_loader,1)
# explicit Personal query filter
text=text.replace(".neq('type','capture').order('id')", ".neq('type','capture').neq('area','Work').order('id')",1)
# send channel through pending sync
text=text.replace("          if(capture.reply_to)form.set('reply_to',capture.reply_to);", "          if(capture.reply_to)form.set('reply_to',capture.reply_to);\n          if(capture.channel)form.set('channel',capture.channel);")
text=text.replace("setLastTurn(turn);setOrbitOpen(false);setOrbitUnread(true);", "setLastTurn(turn);if(capture.channel==='ai')void loadAiHistory();")
# sync dependency
text=text.replace("  },[refresh,updatePending,updateItems]);", "  },[refresh,updatePending,updateItems,loadAiHistory]);",1)
# reset state on account changes
text=text.replace("setLastTurn(null);setOrbitOpen(false);setOrbitUnread(false);", "setLastTurn(null);setAiHistory([]);setAiDraft('');setCompletedQuery('');")
# AI history refresh effect
needle="  useEffect(()=>{if(!feedback)return;const timer=setTimeout(()=>setFeedback(''),9000);return()=>clearTimeout(timer);},[feedback]);"
addition=needle+"\n  useEffect(()=>{if(session&&view==='ai')void loadAiHistory().catch(e=>setError(errorText(e)));},[session?.user.id,view,loadAiHistory]);"
if needle not in text: raise SystemExit('feedback effect missing')
text=text.replace(needle,addition,1)
# Normal typed capture only inherits an outstanding clarification, not ordinary AI chat.
text=text.replace("await queue({id:crypto.randomUUID(),user_id:owner,text:text.trim(),captured_at:new Date().toISOString(),time_zone:Intl.DateTimeFormat().resolvedOptions().timeZone,reply_to:lastTurnRef.current?.id});", "await queue({id:crypto.randomUUID(),user_id:owner,text:text.trim(),captured_at:new Date().toISOString(),time_zone:Intl.DateTimeFormat().resolvedOptions().timeZone,reply_to:lastTurnRef.current?.needs_clarification?lastTurnRef.current.id:undefined,channel:'capture'});")
# Add AI send function after saveText.
needle="  actionRef.current=saveText;"
ai_send="  async function sendAiMessage(text=aiDraft){\n    const owner=sessionRef.current?.user.id;if(!owner){setSheet('account');return;}\n    const message=text.trim();if(!message||message.length>30000)return;\n    setAiDraft('');setError('');\n    await queue({id:crypto.randomUUID(),user_id:owner,text:message,captured_at:new Date().toISOString(),time_zone:Intl.DateTimeFormat().resolvedOptions().timeZone,reply_to:lastTurnRef.current?.id,channel:'ai'});\n  }\n  actionRef.current=saveText;"
if needle not in text: raise SystemExit('actionRef marker missing')
text=text.replace(needle,ai_send,1)
# microphone gets capture/ai channel
text=text.replace("  async function microphone(focusId?:string){", "  async function microphone(focusId?:string,channel:'capture'|'ai'='capture'){")
text=text.replace("    const conversation={reply_to:lastTurnRef.current?.id,focus_id:focusId};", "    const conversation={reply_to:channel==='ai'?lastTurnRef.current?.id:lastTurnRef.current?.needs_clarification?lastTurnRef.current.id:undefined,focus_id:focusId,channel};")
text=text.replace("      const startingDraft=reviewDraft.trim();reviewContext.current={captured_at:capturedAt,...conversation};", "      const startingDraft=(channel==='ai'?aiDraft:reviewDraft).trim();reviewContext.current={captured_at:capturedAt,...conversation};")
old="        const complete=appendSpeech(liveTranscriptRef.current,interimTranscriptRef.current);setReviewDraft(complete);setLiveTranscript(complete);setInterimTranscript('');interimTranscriptRef.current='';\n        if(!complete)setError('I didn’t catch any words. Tap the microphone and try again.');"
new="        const complete=appendSpeech(liveTranscriptRef.current,interimTranscriptRef.current);setLiveTranscript(complete);setInterimTranscript('');interimTranscriptRef.current='';\n        if(channel==='ai')setAiDraft(complete);else setReviewDraft(complete);\n        if(!complete)setError('I didn’t catch any words. Tap the microphone and try again.');"
if old not in text: raise SystemExit('speech end marker missing')
text=text.replace(old,new,1)
text=text.replace("live.start();setRecording(true);setSheet(null);setSelected(null);setView('talk');", "live.start();setRecording(true);setSheet(null);setSelected(null);setView(channel==='ai'?'ai':'talk');",1)
# fallback media recorder has same setView later
text=text.replace("rec.start(1000);setRecording(true);setSheet(null);setSelected(null);setView('talk');", "rec.start(1000);setRecording(true);setSheet(null);setSelected(null);setView(channel==='ai'?'ai':'talk');",1)
# optimistic completion timestamp
text=text.replace("      const next=itemsRef.current.map(i=>i.id===item.id||i.parent_id===item.id?{...i,status}:i);", "      const completedAt=status==='completed'?new Date().toISOString():null;\n      const next=itemsRef.current.map(i=>i.id===item.id||i.parent_id===item.id?{...i,status,completed_at:completedAt}:i);")
# open-item tracking and row styling
needle="  function row(item:Item){\n    const due=dueLabel(item.due_at,item.due_date),subtasks=items.filter(i=>i.parent_id===item.id);\n    return <article className=\"item\" key={item.id}>"
replacement="  async function openItem(item:Item){\n    const owner=sessionRef.current?.user.id,opened=new Date().toISOString();setSelected(item.id);\n    if(owner){const next=itemsRef.current.map(row=>row.id===item.id?{...row,last_opened_at:opened}:row);updateItems(next);await putLocal('cache',{id:owner,items:next,lastTurn:lastTurnRef.current}).catch(()=>{});}\n    if(clientRef.current&&navigator.onLine)void clientRef.current.from('items').update({last_opened_at:opened}).eq('id',item.id).then(({error})=>{if(error)setError('Could not update the opened time.');});\n  }\n  function row(item:Item){\n    const due=dueLabel(item.due_at,item.due_date),subtasks=items.filter(i=>i.parent_id===item.id),stale=view==='today'&&unopenedForDay(item);\n    return <article className={'item '+(stale?'stale-attention':'')} key={item.id}>"
if needle not in text: raise SystemExit('row marker missing')
text=text.replace(needle,replacement,1)
text=text.replace("<button className=\"item-body\" onClick={()=>setSelected(item.id)}>", "<button className=\"item-body\" onClick={()=>void openItem(item)}>",1)
# computed Personal collections
old="  const focusItems=attention(items);\n  const areaItems=items.filter(i=>i.area===area&&i.status==='active'&&!i.parent_id).sort((a,b)=>b.created_at.localeCompare(a.created_at));\n  const completed=items.filter(i=>i.status==='completed'&&!i.parent_id).sort((a,b)=>b.updated_at.localeCompare(a.updated_at));"
new="  const personalItems=items.filter(i=>i.area!=='Work');\n  const focusItems=attention(personalItems);\n  const todayGroups=PERSONAL_AREAS.map(name=>({name,rows:focusItems.filter(item=>item.area===name)})).filter(group=>group.rows.length);\n  const areaItems=personalItems.filter(i=>i.area===area&&i.status==='active'&&!i.parent_id).sort((a,b)=>b.created_at.localeCompare(a.created_at));\n  const generalNotes=personalItems.filter(i=>i.status==='active'&&!i.parent_id&&(i.type==='note'||i.type==='reference')).sort((a,b)=>b.created_at.localeCompare(a.created_at));\n  const completed=personalItems.filter(i=>i.status==='completed'&&!i.parent_id).sort((a,b)=>Date.parse(completionMoment(b))-Date.parse(completionMoment(a)));\n  const completedFiltered=completed.filter(item=>!completedQuery.trim()||[item.title,item.content,item.area,item.type].join(' ').toLowerCase().includes(completedQuery.trim().toLowerCase()));\n  const completedGroups=[...completedFiltered.reduce((map,item)=>{const key=completionDayKey(item),group=map.get(key)??{key,label:completionDayLabel(item),rows:[] as Item[]};group.rows.push(item);map.set(key,group);return map;},new Map<string,{key:string;label:string;rows:Item[]}>()).values()];"
if old not in text: raise SystemExit('computed collections marker missing')
text=text.replace(old,new,1)
# remove floating Orbit bubble entirely
pattern=re.compile(r"\n    \{lastTurn&&<div className=\"orbit-reply\">.*?</div>\}\n    <Tabs value=\{view\}",re.S)
m=pattern.search(text)
if not m: raise SystemExit('orbit bubble block missing')
text=text[:m.start()]+"\n    <Tabs value={view}"+text[m.end():]
# Today grouped by areas with stale callout
old="          {!ready||loading&&!items.length?<p className=\"loading\">Opening your toolbox…</p>:focusItems.length?<div className=\"item-list\">{focusItems.map(row)}</div>:<div className=\"empty\"><Sun/><h3>{session?'Nothing pressing right now.':'A clear place to start.'}</h3><p>{session?'Put down a thought whenever it comes. We’ll keep the rest out of your way.':'Sign in once to keep your thoughts private and available on your devices.'}</p>{!session&&<Button variant=\"ghost\" onClick={()=>setSheet('account')}>Sign in<ChevronRight/></Button>}</div>}"
new="          {!ready||loading&&!items.length?<p className=\"loading\">Opening your toolbox…</p>:todayGroups.length?<div className=\"today-area-grid\">{todayGroups.map(group=>{const Icon=areaIcons[group.name];return <section className=\"today-area-card\" key={group.name}><div className=\"today-area-heading\"><Icon/><div><h3>{group.name}</h3><span>{group.rows.length} {group.rows.length===1?'item':'items'}</span></div></div><div className=\"item-list\">{group.rows.map(row)}</div></section>})}</div>:<div className=\"empty\"><Sun/><h3>{session?'Nothing pressing right now.':'A clear place to start.'}</h3><p>{session?'Put down a thought whenever it comes. We’ll keep the rest out of your way.':'Sign in once to keep your thoughts private and available on your devices.'}</p>{!session&&<Button variant=\"ghost\" onClick={()=>setSheet('account')}>Sign in<ChevronRight/></Button>}</div>}"
if old not in text: raise SystemExit('today marker missing')
text=text.replace(old,new,1)
# Talk note
text=text.replace("<p className=\"quiet-note\">When Orbit has something to say, a message indicator will appear in the corner.</p>", "<p className=\"quiet-note\">Use Talk to put something away. Use AI when you want an actual conversation.</p>")
# Areas: General Notes special card and only Personal areas
old="{area?<><Button variant=\"ghost\" onClick={()=>setArea(null)}><ArrowLeft/>All areas</Button><div className=\"item-list\" style={{marginTop:16}}>{areaItems.slice(0,limit).map(row)}</div>{!areaItems.length&&<div className=\"empty\"><Folder/><h3>Room for your {area.toLowerCase()} thoughts.</h3><p>Speak naturally. We’ll file the right things here.</p></div>}{areaItems.length>limit&&<Button variant=\"ghost\" onClick={()=>setLimit(limit+25)}>Show 25 more</Button>}</>:<div className=\"area-grid\">{AREAS.map(name=>{const Icon=areaIcons[name],count=items.filter(i=>i.area===name&&i.status==='active'&&!i.parent_id).length;return <button key={name} className=\"area-button\" onClick={()=>setArea(name)}><Icon/><span>{name}<small>{count} {count===1?'item':'items'}</small></span></button>;})}</div>}"
new="{area?<><Button variant=\"ghost\" onClick={()=>setArea(null)}><ArrowLeft/>All areas</Button><div className=\"item-list\" style={{marginTop:16}}>{areaItems.slice(0,limit).map(row)}</div>{!areaItems.length&&<div className=\"empty\"><Folder/><h3>Room for your {area.toLowerCase()} thoughts.</h3><p>Speak naturally. We’ll file the right things here.</p></div>}{areaItems.length>limit&&<Button variant=\"ghost\" onClick={()=>setLimit(limit+25)}>Show 25 more</Button>}</>:<><button className=\"general-notes-card\" onClick={()=>setView('notes')}><StickyNote/><span><strong>General Notes</strong><small>{generalNotes.length} saved for later</small></span><ChevronRight/></button><div className=\"area-grid\">{PERSONAL_AREAS.map(name=>{const Icon=areaIcons[name],count=personalItems.filter(i=>i.area===name&&i.status==='active'&&!i.parent_id).length;return <button key={name} className=\"area-button\" onClick={()=>setArea(name)}><Icon/><span>{name}<small>{count} {count===1?'item':'items'}</small></span></button>;})}</div></>}"
if old not in text: raise SystemExit('areas block missing')
text=text.replace(old,new,1)
# Insert Notes view + replace Completed view.
completed_old="      <TabsContent value=\"completed\"><section className=\"intro\"><p className=\"eyebrow\">Off your plate</p><h2>Done and dusted.</h2><p className=\"muted\">A little space to notice what you’ve finished.</p></section>\n        <div className=\"item-list\">{completed.slice(0,limit).map(row)}</div>{!completed.length&&<div className=\"empty\"><CheckCheck/><h3>Your finished tasks will land here.</h3><p>One small thing at a time.</p></div>}\n        {completed.length>limit&&<Button variant=\"ghost\" onClick={()=>setLimit(limit+25)}>Show 25 more</Button>}\n      </TabsContent>"
completed_new="      <TabsContent value=\"notes\"><section className=\"intro\"><p className=\"eyebrow\">Keep without carrying</p><h2>General Notes</h2><p className=\"muted\">Not a to-do. Just things that may matter later.</p></section><Button variant=\"ghost\" onClick={()=>setView('areas')}><ArrowLeft/>Back to Areas</Button><div className=\"item-list\" style={{marginTop:16}}>{generalNotes.slice(0,limit).map(row)}</div>{!generalNotes.length&&<div className=\"empty\"><StickyNote/><h3>Nothing waiting here.</h3><p>Notes and references that are not actions will collect here automatically.</p></div>}{generalNotes.length>limit&&<Button variant=\"ghost\" onClick={()=>setLimit(limit+25)}>Show 25 more</Button>}</TabsContent>\n      <TabsContent value=\"completed\"><section className=\"intro\"><p className=\"eyebrow\">Off your plate</p><h2>Done and dusted.</h2><p className=\"muted\">Finished items, organized by when you finished them.</p></section><label className=\"completed-search\"><Search/><Input aria-label=\"Search completed items\" placeholder=\"Search finished items…\" value={completedQuery} onChange={e=>setCompletedQuery(e.target.value)}/></label>\n        {completedGroups.slice(0,limit).map(group=><section className=\"completed-day\" key={group.key}><h3>{group.label}</h3><div className=\"item-list\">{group.rows.map(row)}</div></section>)}{!completedFiltered.length&&<div className=\"empty\"><CheckCheck/><h3>{completed.length?'No finished items match that search.':'Your finished tasks will land here.'}</h3><p>{completed.length?'Try a different word.':'One small thing at a time.'}</p></div>}\n        {completedGroups.length>limit&&<Button variant=\"ghost\" onClick={()=>setLimit(limit+25)}>Show more dates</Button>}\n      </TabsContent>"
if completed_old not in text: raise SystemExit('completed block missing')
text=text.replace(completed_old,completed_new,1)
# Insert AI tab before nav and make five-tab nav.
nav_old="      <nav className=\"bottom-nav\" aria-label=\"Main navigation\"><TabsList><TabsTrigger value=\"today\"><Sun/>Today</TabsTrigger><TabsTrigger value=\"talk\"><Mic/>Talk</TabsTrigger><TabsTrigger value=\"areas\"><Layers/>Areas</TabsTrigger><TabsTrigger value=\"completed\"><CheckCheck/>Completed</TabsTrigger></TabsList></nav>"
ai_block="      <TabsContent value=\"ai\"><section className=\"intro\"><p className=\"eyebrow\">Ask, plan, think out loud</p><h2>AI</h2><p className=\"muted\">Have a conversation here. Type or use your voice.</p></section><section className=\"ai-panel\"><div className=\"ai-thread\">{aiHistory.map(turn=><div className=\"ai-exchange\" key={turn.id}><div className=\"ai-user\"><span>You</span><p>{turn.source_text}</p></div>{turn.turn_result?.reply&&<div className={'ai-orbit '+(turn.turn_result.needs_clarification?'question':'')}><span>{turn.turn_result.needs_clarification?'Orbit needs one detail':'Orbit'}</span><p>{turn.turn_result.reply}</p></div>}</div>)}{lastTurn&&!aiHistory.some(turn=>turn.id===lastTurn.id)&&<div className={'ai-orbit '+(lastTurn.needs_clarification?'question':'')}><span>{lastTurn.needs_clarification?'Orbit needs one detail':'Orbit'}</span><p>{lastTurn.reply}</p></div>}{pending.filter(capture=>capture.channel==='ai').map(capture=><div className=\"ai-user pending\" key={capture.id}><span>You · sending</span><p>{capture.text||'Voice message waiting to process'}</p></div>)}{!aiHistory.length&&!lastTurn&&!pending.some(capture=>capture.channel==='ai')&&<div className=\"empty\"><MessageSquareText/><h3>Start a conversation.</h3><p>Ask a question, think through a plan, or talk something out.</p></div>}</div>{recording&&view==='ai'&&<div className=\"ai-live\"><p>{liveTranscript}{interimTranscript&&<span> {interimTranscript}</span>}</p><Button type=\"button\" variant=\"outline\" onClick={()=>void microphone(undefined,'ai')}><Square fill=\"currentColor\"/>Stop</Button></div>}<form className=\"ai-compose\" onSubmit={e=>{e.preventDefault();void sendAiMessage().catch(e=>setError(errorText(e)));}}><Textarea aria-label=\"Message Orbit\" placeholder=\"Message Orbit…\" value={aiDraft} onChange={e=>setAiDraft(e.target.value)} maxLength={30000} disabled={recording}/><div><Button type=\"button\" variant=\"outline\" onClick={()=>void microphone(undefined,'ai')} disabled={starting||busy&&!recording}>{starting?<LoaderCircle className=\"spinning\"/>:<Mic/>}{recording?'Stop':'Voice'}</Button><Button type=\"submit\" disabled={!aiDraft.trim()||busy||recording}>Send</Button></div></form></section></TabsContent>\n      <nav className=\"bottom-nav\" aria-label=\"Main navigation\"><TabsList><TabsTrigger value=\"today\"><Sun/>Today</TabsTrigger><TabsTrigger value=\"talk\"><Mic/>Talk</TabsTrigger><TabsTrigger value=\"areas\"><Layers/>Areas</TabsTrigger><TabsTrigger value=\"completed\"><CheckCheck/>Done</TabsTrigger><TabsTrigger value=\"ai\"><MessageSquareText/>AI</TabsTrigger></TabsList></nav>"
if nav_old not in text: raise SystemExit('nav block missing')
text=text.replace(nav_old,ai_block,1)
# Pending capture label.
text=text.replace("<h3>{p.audio?'Voice capture':'Written capture'}</h3>", "<h3>{p.channel==='ai'?'AI message':p.audio?'Voice capture':'Written capture'}</h3>")
# Personal area selector excludes Work.
text=text.replace("{AREAS.map(a=><SelectItem key={a} value={a}>{a}</SelectItem>)}", "{PERSONAL_AREAS.map(a=><SelectItem key={a} value={a}>{a}</SelectItem>)}")
# Connected steps label in detail.
text=text.replace("{items.some(i=>i.parent_id===current.id)&&<div className=\"item-list\">{items.filter(i=>i.parent_id===current.id).map(row)}</div>}", "{items.some(i=>i.parent_id===current.id)&&<section className=\"connected-steps\"><div className=\"section-heading\"><h3>Connected steps</h3><span className=\"muted\">In a useful order</span></div><div className=\"item-list\">{items.filter(i=>i.parent_id===current.id).map(row)}</div></section>}")
p.write_text(text)

# ---- CSS ----
p=Path('app/toolbox.css'); css=p.read_text()
# Work-like talk button visual.
css=css.replace(".mic-button { width:94px!important; height:94px!important; border-radius:50%!important; margin:21px auto 14px; background:#2458d3; color:#fff; box-shadow:0 7px 22px #2458d32a; }", ".mic-button { width:108px!important; height:108px!important; border-radius:50%!important; margin:24px auto 14px; background:linear-gradient(145deg,#3ca0ff,#1680ee)!important; color:#fff; border:3px solid #d8ecff!important; box-shadow:0 0 0 14px #2c91fa12,0 15px 34px #1f86ed30!important; }")
css += r'''

/* Personal mode refresh */
.today-area-grid{display:grid;gap:14px}.today-area-card{border:1px solid var(--border);border-radius:20px;background:#fff;overflow:hidden}.today-area-heading{display:flex;align-items:center;gap:10px;padding:13px 15px;background:#f7faff;border-bottom:1px solid #e6edf6}.today-area-heading>svg{width:21px;color:#416caf}.today-area-heading h3{font-size:.95rem}.today-area-heading span{font-size:.76rem;color:#6b7890}.today-area-card .item-list{gap:0}.today-area-card .item{border:0;border-bottom:1px solid #edf1f6;border-radius:0}.today-area-card .item:last-child{border-bottom:0}.item.stale-attention{border-color:#e7b557;background:#fffaf0;box-shadow:inset 4px 0 0 #e8a82d}.item.stale-attention .item-title:after{content:' · needs a look';font-size:.76rem;color:#9a6509;font-weight:650}.general-notes-card{width:100%;display:flex;align-items:center;gap:13px;margin:4px 0 14px;padding:17px;border:1px solid #dfe5ef;border-radius:18px;background:#fff;text-align:left;color:inherit}.general-notes-card>svg:first-child{width:24px;color:#7a63b8}.general-notes-card>span{flex:1;display:grid}.general-notes-card strong{font-size:1rem}.general-notes-card small{color:#66758d;margin-top:2px}.general-notes-card>svg:last-child{width:18px;color:#8390a3}.completed-search{position:relative;display:block;margin:0 0 18px}.completed-search>svg{position:absolute;left:14px;top:50%;transform:translateY(-50%);width:18px;color:#75839a;z-index:1}.completed-search input{padding-left:42px!important}.completed-day{margin:0 0 20px}.completed-day>h3{margin:0 0 9px;color:#56667e;font-size:.82rem;text-transform:uppercase;letter-spacing:.06em}.connected-steps{margin-top:18px;padding-top:16px;border-top:1px solid var(--border)}.connected-steps .section-heading{margin-bottom:10px}.ai-panel{display:grid;gap:16px}.ai-thread{display:grid;gap:14px;max-height:52dvh;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:2px}.ai-exchange{display:grid;gap:8px}.ai-user,.ai-orbit{max-width:88%;padding:12px 14px;border-radius:17px}.ai-user{justify-self:end;background:#2458d3;color:#fff;border-bottom-right-radius:5px}.ai-user.pending{opacity:.65}.ai-orbit{justify-self:start;background:#fff;border:1px solid var(--border);border-bottom-left-radius:5px}.ai-orbit.question{border-color:#ecd29d;background:#fffaf0}.ai-user span,.ai-orbit span{display:block;font-size:.7rem;font-weight:750;letter-spacing:.05em;text-transform:uppercase;opacity:.75;margin-bottom:3px}.ai-user p,.ai-orbit p{white-space:pre-wrap;line-height:1.5}.ai-compose{display:grid;gap:10px;padding:12px;background:#fff;border:1px solid var(--border);border-radius:18px;position:sticky;bottom:82px}.ai-compose textarea{min-height:90px!important}.ai-compose>div{display:grid;grid-template-columns:auto 1fr;gap:9px}.ai-live{padding:13px 15px;border:1px solid #d9e7f7;background:#f7fbff;border-radius:16px}.ai-live p{white-space:pre-wrap;margin-bottom:10px}.ai-live span{color:#718097}.bottom-nav [role=tablist]{gap:5px}.bottom-nav [role=tab]{padding-left:4px;padding-right:4px;font-size:.8rem}
@media(max-width:430px){.ai-user,.ai-orbit{max-width:94%}.bottom-nav [role=tab]{font-size:.72rem}.bottom-nav [role=tab] svg{width:19px;height:19px}}
'''
p.write_text(css)

# ---- schema bootstrap reference ----
p=Path('supabase/schema.sql'); text=p.read_text()
text=text.replace(" updated_at timestamptz not null default now(),", " updated_at timestamptz not null default now(),\n completed_at timestamptz,\n last_opened_at timestamptz,")
old="create function public.toolbox_touch_item() returns trigger language plpgsql set search_path='' as $$\nbegin\n new.updated_at=now();"
new="create function public.toolbox_touch_item() returns trigger language plpgsql set search_path='' as $$\nbegin\n if tg_op='INSERT' then\n   new.updated_at=coalesce(new.updated_at,now());\n   if new.type<>'capture' and new.last_opened_at is null then new.last_opened_at=coalesce(new.created_at,now()); end if;\n   if new.type<>'capture' and new.status='completed' and new.completed_at is null then new.completed_at=now(); end if;\n else\n   new.updated_at=now();\n   if new.type<>'capture' and old.status is distinct from new.status then\n     if new.status='completed' then new.completed_at=now(); end if;\n     if new.status='active' then new.completed_at=null; end if;\n   end if;\n end if;"
if old not in text: raise SystemExit('schema trigger marker missing')
text=text.replace(old,new,1)
text=text.replace("create index items_capture_owner on public.items(capture_id,user_id);", "create index items_capture_owner on public.items(capture_id,user_id);\ncreate index items_owner_completed_at on public.items(user_id,completed_at desc) where type<>'capture' and status='completed';")
p.write_text(text)

# ---- tests ----
Path('tests/personal-mode.test.ts').write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import {PERSONAL_AREAS,unopenedForDay,completionDayKey} from '../lib/items.ts';
import {captureInstructions} from '../lib/capture-schema.ts';

test('Personal areas exclude Work and Personal prompt enforces separation',()=>{
  assert.equal(PERSONAL_AREAS.includes('Work' as never),false);
  const prompt=captureInstructions('2026-09-11T16:00:00-04:00','America/New_York','personal');
  assert.match(prompt,/Keep Work completely separate/);
  assert.match(prompt,/CONNECTED ACTIONS/);
  assert.match(prompt,/GENERAL NOTES/);
});

test('24-hour unopened highlighting uses last opened time',()=>{
  assert.equal(unopenedForDay({type:'task',status:'active',created_at:'2026-09-09T12:00:00Z',last_opened_at:'2026-09-10T12:00:00Z'},Date.parse('2026-09-11T13:00:00Z')),true);
  assert.equal(unopenedForDay({type:'note',status:'active',created_at:'2026-09-09T12:00:00Z',last_opened_at:null},Date.parse('2026-09-11T13:00:00Z')),false);
});

test('completed items group by durable completed_at',()=>{
  assert.equal(completionDayKey({completed_at:'2026-09-10T23:00:00Z',updated_at:'2026-09-11T15:00:00Z'}),'2026-09-10');
});
''')
Path('tests/personal-ui.test.ts').write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Personal UI has dedicated AI section and no floating Orbit bubble',async()=>{
  const source=await readFile(new URL('../app/toolbox.tsx',import.meta.url),'utf8');
  assert.match(source,/TabsTrigger value="ai"/);
  assert.match(source,/Message Orbit/);
  assert.match(source,/General Notes/);
  assert.match(source,/Search finished items/);
  assert.doesNotMatch(source,/className={'orbit-button/);
  assert.match(source,/today-area-grid/);
});
''')
