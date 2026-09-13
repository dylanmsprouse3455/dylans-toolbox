'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {Session,SupabaseClient} from '@supabase/supabase-js';
import {Mic,Square,PenLine,Sun,Layers,CheckCheck,BriefcaseBusiness,House,Wallet,UserRound,Users,Folder,Lightbulb,Inbox,Check,CheckCircle2,Circle,ChevronRight,ArrowLeft,WifiOff,LoaderCircle,Settings2,FileText,Bookmark,CloudUpload,LogOut,ShieldCheck,Box,MessageSquareText,Search,StickyNote,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {PersonalRecovery} from '@/components/personal-recovery';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Tabs,TabsContent,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {Sheet,SheetContent,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {getSupabase} from '@/lib/supabase';
import {appBase,captureUrl,publicConfig} from '@/lib/public-config';
import {AREAS,PERSONAL_AREAS,actionable,attention,dueLabel,dueTime,quadrant,unopenedForDay,completionDayKey,completionDayLabel,completionMoment,type Area,type Item,type ItemType} from '@/lib/items';
import {acceptCapture,cachedItems,cachedTurn,displayTurn,capturesFor,changesFor,putLocal,removeLocal,type Capture,type Change,type TurnReceipt,type AssistantTurn} from '@/lib/local';
import {stopSpeaking} from '@/lib/speech';
import {appendSpeech,thoughtLines} from '@/lib/live-speech';

type SpeechResultLike={isFinal:boolean;0:{transcript:string};length:number};
type SpeechEventLike={resultIndex:number;results:ArrayLike<SpeechResultLike>};
type SpeechRecognitionLike={continuous:boolean;interimResults:boolean;lang:string;onresult:((event:SpeechEventLike)=>void)|null;onerror:(()=>void)|null;onend:(()=>void)|null;start:()=>void;stop:()=>void;abort:()=>void};
type SpeechRecognitionWindow=Window&{SpeechRecognition?:new()=>SpeechRecognitionLike;webkitSpeechRecognition?:new()=>SpeechRecognitionLike};
type AiHistoryRow={id:string;source_text:string;turn_result:{reply?:string;needs_clarification?:boolean}|null;created_at:string};

const areaIcons={Work:BriefcaseBusiness,Home:House,Money:Wallet,Personal:UserRound,People:Users,Projects:Folder,Ideas:Lightbulb,Inbox};
const errorText=(e:unknown)=>e instanceof Error?e.message:'Something went wrong. Please try again.';

export default function Toolbox(){
  const [session,setSession]=useState<Session|null>(null);
  const [ready,setReady]=useState(false),[items,setItems]=useState<Item[]>([]);
  const [view,setView]=useState('today'),[area,setArea]=useState<Area|null>(null),[limit,setLimit]=useState(25);
  const [online,setOnline]=useState(true),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
  const [error,setError]=useState(''),[feedback,setFeedback]=useState('');
  const [pending,setPending]=useState<Capture[]>([]),[pendingChanges,setPendingChanges]=useState(0);
  const [unsaved,setUnsaved]=useState<Capture[]>([]);
  const [lastTurn,setLastTurn]=useState<AssistantTurn|null>(null);
  const [aiDraft,setAiDraft]=useState(''),[aiHistory,setAiHistory]=useState<AiHistoryRow[]>([]),[completedQuery,setCompletedQuery]=useState('');
  const lastTurnRef=useRef<AssistantTurn|null>(null);
  const [sheet,setSheet]=useState<'write'|'account'|'pending'|null>(null);
  const [draft,setDraft]=useState(''),[selected,setSelected]=useState<string|null>(null);
  const [recording,setRecording]=useState(false),[seconds,setSeconds]=useState(0),[starting,setStarting]=useState(false);
  const [liveTranscript,setLiveTranscript]=useState(''),[interimTranscript,setInterimTranscript]=useState(''),[liveWordsAvailable,setLiveWordsAvailable]=useState(true);
  const [reviewDraft,setReviewDraft]=useState('');
  const [email,setEmail]=useState(''),[password,setPassword]=useState('');
  const [settingPassword,setSettingPassword]=useState(()=>typeof location!=='undefined'&&['invite','recovery'].includes(new URLSearchParams(location.hash.slice(1)).get('type')||''));
  const [authBusy,setAuthBusy]=useState(false),[authMessage,setAuthMessage]=useState('');
  const [editing,setEditing]=useState(false),[editTitle,setEditTitle]=useState(''),[editContent,setEditContent]=useState('');
  const [editArea,setEditArea]=useState<Area>('Inbox'),[editType,setEditType]=useState<ItemType>('task'),[editDate,setEditDate]=useState('');
  const [editImportance,setEditImportance]=useState('3'),[editUrgency,setEditUrgency]=useState('3'),[editBusy,setEditBusy]=useState(false);
  const [subTitle,setSubTitle]=useState(''),[today,setToday]=useState('');
  const clientRef=useRef<SupabaseClient|null>(null),sessionRef=useRef<Session|null>(null),itemsRef=useRef<Item[]>([]);
  const lock=useRef(false),refreshLock=useRef(false),recorder=useRef<MediaRecorder|null>(null);
  const recordingOwner=useRef<string|null>(null),recTimer=useRef<ReturnType<typeof setInterval>|null>(null);
  const recognition=useRef<SpeechRecognitionLike|null>(null),liveTranscriptRef=useRef(''),interimTranscriptRef=useRef('');
  const reviewContext=useRef<{captured_at:string;focus_id?:string;reply_to?:string;channel?:'capture'|'ai'}|null>(null);
  const unmounted=useRef(false);
  const actionRef=useRef<(text:string)=>Promise<void>>(async()=>{});
  const authGeneration=useRef(0);

  const updateItems=useCallback((next:Item[])=>{itemsRef.current=next;setItems(next);},[]);
  const updatePending=useCallback(async()=>{
    const owner=sessionRef.current?.user.id;if(!owner)return;
    const [captures,changes]=await Promise.all([capturesFor(owner),changesFor(owner)]);
    if(sessionRef.current?.user.id===owner){setPending(captures);setPendingChanges(changes.length);}
  },[]);
  const loadAiHistory=useCallback(async()=>{
    const client=clientRef.current,owner=sessionRef.current?.user.id;if(!client||!owner||!navigator.onLine)return;
    const result=await client.from('items').select('id,source_text,turn_result,created_at').eq('user_id',owner).eq('type','capture').eq('title','AI conversation').eq('status','processed').order('created_at',{ascending:false}).limit(30);
    if(result.error)throw result.error;setAiHistory(((result.data??[]) as AiHistoryRow[]).reverse());
  },[]);
  const refresh=useCallback(async()=>{
    const client=clientRef.current,owner=sessionRef.current?.user.id;
    if(!client||!owner||!navigator.onLine||refreshLock.current)return;
    refreshLock.current=true;
    const snapshot=itemsRef.current;
    try{
      const records:Item[]=[];
      for(let from=0;;from+=500){
        const {data,error}=await client.from('items').select('*').eq('user_id',owner).neq('type','capture').neq('area','Work').order('id').range(from,from+499);
        if(error)throw error;
        records.push(...(data as Item[]));
        if(data.length<500)break;
      }
      const changes=await changesFor(owner);
      for(const change of changes)for(const item of records)if(item.id===change.item_id||item.parent_id===change.item_id)item.status=change.status;
      if(sessionRef.current?.user.id!==owner||itemsRef.current!==snapshot)return;
      updateItems(records);
      await putLocal('cache',{id:owner,items:records,lastTurn:lastTurnRef.current});
    }finally{refreshLock.current=false;}
  },[updateItems]);
  const sync=useCallback(async()=>{
    const client=clientRef.current,owner=sessionRef.current?.user.id;
    if(!client||!owner||!navigator.onLine||lock.current)return;
    lock.current=true;setBusy(true);
    try{
      const changes=await changesFor(owner);
      for(const change of changes){
        if(sessionRef.current?.user.id!==owner)break;
        const {error}=await client.rpc('toolbox_set_status',{item_uuid:change.item_id,new_status:change.status});
        if(error)throw new Error('Your changes are saved on this device and will sync when the connection returns.');
        await removeLocal('changes',change.id);
      }
      const captures=await capturesFor(owner);
      for(const capture of captures){
        if(sessionRef.current?.user.id!==owner)break;
        try{
          const {data}=await client.auth.getSession();
          if(!data.session||data.session.user.id!==owner)throw new Error('Please sign in again to process pending captures.');
          const form=new FormData();
          form.set('id',capture.id);form.set('captured_at',capture.captured_at);form.set('time_zone',capture.time_zone);
          if(capture.text)form.set('text',capture.text);
          if(capture.audio)form.set('audio',capture.audio,'recording');
          if(capture.focus_id)form.set('focus_id',capture.focus_id);
          if(capture.reply_to)form.set('reply_to',capture.reply_to);
          if(capture.channel)form.set('channel',capture.channel);
          const response=await fetch(captureUrl,{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token,apikey:publicConfig.key},body:form,signal:AbortSignal.timeout(190000)});
          const result=await response.json() as TurnReceipt&{error?:string};
          if(!response.ok)throw new Error(result.error||'Your capture is saved. Processing will retry.');
          const cached=await acceptCapture(capture,result.items,result.turn_id?result:undefined);
          if(sessionRef.current?.user.id!==owner)break;
          updateItems(cached);
          if(result.turn_id){const turn=displayTurn(result);lastTurnRef.current=turn;setLastTurn(turn);if(capture.channel==='ai')void loadAiHistory();}
          const newItems=result.items as Item[];
          setFeedback(result.turn_id?'':newItems.length?'Put away '+newItems.length+' '+(newItems.length===1?'item':'items')+'. We’ll surface what matters.':'Nothing to add from that capture.');
          await updatePending();
        }catch(e){
          capture.error=errorText(e);await putLocal('captures',capture);
          // A failed capture cannot block unrelated later captures.
        }
      }
      await refresh();await updatePending();
    }catch(e){if(sessionRef.current?.user.id===owner)setError(errorText(e));}
    finally{lock.current=false;setBusy(false);}
  },[refresh,updatePending,updateItems,loadAiHistory]);

  useEffect(()=>{
    unmounted.current=false;setOnline(navigator.onLine);
    setToday(new Date().toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'}));
    let unsubscribe:(()=>void)|undefined;
    getSupabase().then(async client=>{
      if(unmounted.current)return;clientRef.current=client;
      const accept=async(next:Session|null)=>{
        const generation=++authGeneration.current;
        if(next){
          try{
            const allowed=navigator.onLine?await client.rpc('toolbox_can_access'):{data:localStorage.getItem('toolbox-verified-owner')===next.user.id,error:null};
            if(allowed.error)throw new Error('Could not verify access. Reconnect and sign in again.');
            if(allowed.data!==true)throw new Error('This toolbox is private. Only its owner can sign in.');
            if(generation!==authGeneration.current)return;
            localStorage.setItem('toolbox-verified-owner',next.user.id);
          }catch(e){if(generation!==authGeneration.current)return;next=null;setAuthMessage(errorText(e));}
        }
        if(generation!==authGeneration.current||unmounted.current)return;
        const previous=sessionRef.current?.user.id;
        sessionRef.current=next;setSession(next);
        if(previous!==next?.user.id){
          updateItems([]);setPending([]);setPendingChanges(0);setSelected(null);setDraft('');setError('');setFeedback('');setSheet(null);setEditing(false);lastTurnRef.current=null;setLastTurn(null);setAiHistory([]);setAiDraft('');setCompletedQuery('');
          if(next){
            try{const [cache,turn]=await Promise.all([cachedItems(next.user.id),cachedTurn(next.user.id)]);if(sessionRef.current?.user.id===next.user.id){updateItems(cache);lastTurnRef.current=turn;setLastTurn(turn);}await updatePending();}catch(e){setError(errorText(e));}
          }
        }
        setReady(true);
      };
      const {data}=await client.auth.getSession();await accept(data.session);
      const auth=client.auth.onAuthStateChange((event,next)=>{if(event==='PASSWORD_RECOVERY')setSettingPassword(true);setTimeout(()=>{void accept(next);},0);});
      unsubscribe=()=>auth.data.subscription.unsubscribe();
    }).catch(e=>{setError(errorText(e));setReady(true);});
    if('serviceWorker'in navigator)navigator.serviceWorker.register(new URL('sw.js',appBase()),{scope:appBase().pathname}).catch(()=>{});
    const connection=()=>setOnline(navigator.onLine);
    window.addEventListener('online',connection);window.addEventListener('offline',connection);
    return()=>{unmounted.current=true;unsubscribe?.();window.removeEventListener('online',connection);window.removeEventListener('offline',connection);
      if(recorder.current?.state==='recording')recorder.current.stop();recognition.current?.abort();stopSpeaking();};
  },[updateItems,updatePending]);
  useEffect(()=>{
    if(!session)return;
    setLoading(true);void sync().finally(()=>setLoading(false));
    const wake=()=>{if(document.visibilityState==='visible')void sync();};
    const timer=setInterval(wake,60000);
    window.addEventListener('online',wake);window.addEventListener('focus',wake);document.addEventListener('visibilitychange',wake);
    const refreshTimer=setInterval(()=>{if(document.visibilityState==='visible'&&!lock.current)void refresh().catch(()=>{});},20000);
    return()=>{clearInterval(timer);clearInterval(refreshTimer);window.removeEventListener('online',wake);window.removeEventListener('focus',wake);document.removeEventListener('visibilitychange',wake);};
  },[session?.user.id,sync,refresh]);
  useEffect(()=>{if(!feedback)return;const timer=setTimeout(()=>setFeedback(''),9000);return()=>clearTimeout(timer);},[feedback]);
  useEffect(()=>{if(session&&view==='ai')void loadAiHistory().catch(e=>setError(errorText(e)));},[session?.user.id,view,loadAiHistory]);
  useEffect(()=>{setLimit(25);},[view,area]);
  useEffect(()=>{setEditing(false);setSubTitle('');},[selected]);
  useEffect(()=>{
    if(!recording&&!unsaved.length)return;
    const protect=(e:BeforeUnloadEvent)=>{e.preventDefault();};
    const stopOnHide=()=>{if(document.visibilityState==='hidden'&&recorder.current?.state==='recording')recorder.current.stop();};
    window.addEventListener('beforeunload',protect);document.addEventListener('visibilitychange',stopOnHide);
    return()=>{window.removeEventListener('beforeunload',protect);document.removeEventListener('visibilitychange',stopOnHide);};
  },[recording,unsaved.length]);

  async function queue(capture:Capture){
    try{await putLocal('captures',capture);}
    catch(e){
      setUnsaved(previous=>[...previous.filter(item=>item.id!==capture.id),capture]);
      setSheet(null);setSelected(null);
      throw e;
    }
    setUnsaved(previous=>previous.filter(item=>item.id!==capture.id));
    if(sessionRef.current?.user.id!==capture.user_id)return;
    setError('');setFeedback(capture.channel==='ai'?(online?'Sending to Orbit…':'Saved on this device. It’ll send when you reconnect.'):(online?'Saved on this device. Organizing your thoughts…':'Saved on this device. We’ll organize it when you reconnect.'));
    await updatePending().catch(()=>setError('Your capture was saved, but the pending list could not refresh. Keep this window open and retry.'));
    void navigator.storage?.persist?.().catch(()=>{});
    void sync();
  }
  async function saveText(text=draft){
    const owner=sessionRef.current?.user.id;
    if(!owner){setSheet('account');throw new Error('Sign in before saving.');}
    if(!text.trim()||text.length>30000)throw new Error('Add a thought under 30,000 characters.');
    await queue({id:crypto.randomUUID(),user_id:owner,text:text.trim(),captured_at:new Date().toISOString(),time_zone:Intl.DateTimeFormat().resolvedOptions().timeZone,reply_to:lastTurnRef.current?.needs_clarification?lastTurnRef.current.id:undefined,channel:'capture'});
    setDraft('');setSheet(null);
  }
  async function sendAiMessage(text=aiDraft){
    const owner=sessionRef.current?.user.id;if(!owner){setSheet('account');return;}
    const message=text.trim();if(!message||message.length>30000)return;
    setAiDraft('');setError('');
    await queue({id:crypto.randomUUID(),user_id:owner,text:message,captured_at:new Date().toISOString(),time_zone:Intl.DateTimeFormat().resolvedOptions().timeZone,reply_to:aiHistory.at(-1)?.id,channel:'ai'});
  }
  actionRef.current=saveText;
  useEffect(()=>{
    const context=(document as Document&{modelContext?:{registerTool:(tool:unknown,options:unknown)=>void}}).modelContext;
    if(!context?.registerTool)return;
    const lifecycle=new AbortController();
    try{context.registerTool({name:'capture_thought',description:'Save a spoken or typed thought to the current user’s local queue for automatic organization. Requires sign-in; processing may remain pending while offline.',
      inputSchema:{type:'object',properties:{text:{type:'string',minLength:1,maxLength:30000}},required:['text'],additionalProperties:false},
      annotations:{readOnlyHint:false,untrustedContentHint:false},
      execute:async(input:unknown)=>{if(!input||typeof input!=='object'||!('text'in input)||typeof input.text!=='string'||!input.text.trim()||input.text.length>30000)throw new Error('A non-empty text capture is required.');await actionRef.current(input.text);return {saved:true,status:'queued'};}},
      {signal:lifecycle.signal});}catch{}
    return()=>lifecycle.abort();
  },[]);
  async function microphone(focusId?:string,channel:'capture'|'ai'='capture'){
    if(recording){if(recognition.current)recognition.current.stop();else recorder.current?.stop();return;}
    stopSpeaking();
    const owner=sessionRef.current?.user.id;
    if(!owner){setSheet('account');return;}
    const conversation={reply_to:channel==='ai'?aiHistory.at(-1)?.id:lastTurnRef.current?.needs_clarification?lastTurnRef.current.id:undefined,focus_id:focusId,channel};
    setStarting(true);setError('');
    const capturedAt=new Date().toISOString();
    const Recognition=(window as SpeechRecognitionWindow).SpeechRecognition??(window as SpeechRecognitionWindow).webkitSpeechRecognition;
    if(Recognition){
      const startingDraft=(channel==='ai'?aiDraft:reviewDraft).trim();reviewContext.current={captured_at:capturedAt,...conversation};
      liveTranscriptRef.current=startingDraft;interimTranscriptRef.current='';setLiveTranscript(startingDraft);setInterimTranscript('');setReviewDraft('');setLiveWordsAvailable(true);setSeconds(0);
      const live=new Recognition();recognition.current=live;live.continuous=true;live.interimResults=true;live.lang='en-US';
      live.onresult=event=>{
        let final='',interim='';
        for(let i=event.resultIndex;i<event.results.length;i++){
          const words=event.results[i][0]?.transcript??'';
          if(event.results[i].isFinal)final=appendSpeech(final,words);else interim=appendSpeech(interim,words);
        }
        if(final){liveTranscriptRef.current=appendSpeech(liveTranscriptRef.current,final);setLiveTranscript(liveTranscriptRef.current);}
        interimTranscriptRef.current=interim;setInterimTranscript(interim);
      };
      live.onerror=()=>setLiveWordsAvailable(false);
      live.onend=()=>{
        recognition.current=null;if(recTimer.current)clearInterval(recTimer.current);setRecording(false);
        const complete=appendSpeech(liveTranscriptRef.current,interimTranscriptRef.current);setLiveTranscript(complete);setInterimTranscript('');interimTranscriptRef.current='';
        if(channel==='ai')setAiDraft(complete);else setReviewDraft(complete);
        if(!complete)setError('I didn’t catch any words. Tap the microphone and try again.');
      };
      try{
        live.start();setRecording(true);setSheet(null);setSelected(null);setView(channel==='ai'?'ai':'talk');
        let elapsed=0;recTimer.current=setInterval(()=>{elapsed++;setSeconds(elapsed);if(elapsed>=300)live.stop();},1000);
      }catch{recognition.current=null;setLiveWordsAvailable(false);setError('The microphone could not start. Check Safari’s microphone permission and try again.');}
      finally{setStarting(false);}
      return;
    }
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){setError('Voice recording isn’t available here. You can type your thought instead.');setSheet('write');setStarting(false);return;}
    let stream:MediaStream|undefined;
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:true});
      if(sessionRef.current?.user.id!==owner){stream.getTracks().forEach(t=>t.stop());return;}
      const mime=['audio/mp4','audio/webm;codecs=opus','audio/webm'].find(type=>MediaRecorder.isTypeSupported(type));
      const rec=new MediaRecorder(stream,mime?{mimeType:mime}:undefined),chunks:Blob[]=[];
      recordingOwner.current=owner;recorder.current=rec;setSeconds(0);liveTranscriptRef.current='';setLiveTranscript('');setInterimTranscript('');setLiveWordsAvailable(true);
      rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      rec.onerror=()=>{setError('Recording was interrupted. Any recorded audio will be kept.');if(rec.state!=='inactive')rec.stop();};
      rec.onstop=async()=>{
        if(recTimer.current)clearInterval(recTimer.current);
        stream?.getTracks().forEach(t=>t.stop());setRecording(false);
        const audio=new Blob(chunks,{type:rec.mimeType||mime||'audio/mp4'});
        if(!audio.size){setError('No audio was recorded. Please try again.');return;}
        try{await queue({id:crypto.randomUUID(),user_id:owner,audio,captured_at:capturedAt,time_zone:Intl.DateTimeFormat().resolvedOptions().timeZone,...conversation});}
        catch(e){setError(errorText(e));}
      };
      setLiveWordsAvailable(false);
      rec.start(1000);setRecording(true);setSheet(null);setSelected(null);setView(channel==='ai'?'ai':'talk');
      let elapsed=0;recTimer.current=setInterval(()=>{elapsed++;setSeconds(elapsed);if(elapsed>=300&&rec.state==='recording')rec.stop();},1000);
    }catch(e){stream?.getTracks().forEach(t=>t.stop());setError(e instanceof DOMException&&e.name==='NotAllowedError'?'Microphone access is off. Allow it in Safari’s website settings, or type your thought.':errorText(e));}
    finally{setStarting(false);}
  }
  async function approveReview(){
    const owner=sessionRef.current?.user.id,context=reviewContext.current,text=reviewDraft.trim();
    if(!owner||!context||!text)return;
    try{
      await queue({id:crypto.randomUUID(),user_id:owner,text,captured_at:context.captured_at,time_zone:Intl.DateTimeFormat().resolvedOptions().timeZone,focus_id:context.focus_id,reply_to:context.reply_to});
      setReviewDraft('');setLiveTranscript('');reviewContext.current=null;
    }catch(e){setError(errorText(e));}
  }
  async function changeStatus(item:Item){
    const owner=sessionRef.current?.user.id;if(!owner)return;
    const status:Item['status']=item.status==='completed'?'active':'completed';
    try{
      const change:Change={id:Date.now()+'-'+crypto.randomUUID(),user_id:owner,item_id:item.id,status};
      await putLocal('changes',change);
      const completedAt=status==='completed'?new Date().toISOString():null;
      const next=itemsRef.current.map(i=>i.id===item.id||i.parent_id===item.id?{...i,status,completed_at:completedAt}:i);
      updateItems(next);await putLocal('cache',{id:owner,items:next,lastTurn:lastTurnRef.current});await updatePending();
      setFeedback(status==='completed'?'One less thing to carry.':'Task reopened.');void sync();
    }catch(e){setError(errorText(e));}
  }
  async function signIn(e:React.FormEvent){
    e.preventDefault();setAuthBusy(true);setAuthMessage('');
    try{
      const client=clientRef.current??await getSupabase();clientRef.current=client;
      const result=await client.auth.signInWithPassword({email,password});
      if(result.error)throw result.error;
      const {data:allowed,error:accessError}=await client.rpc('toolbox_can_access');
      if(accessError||allowed!==true){await client.auth.signOut({scope:'local'});throw new Error('This toolbox is private. Only its owner can sign in.');}
      setSheet(null);setPassword('');
    }catch(e){setAuthMessage(errorText(e));}finally{setAuthBusy(false);}
  }
  async function signOut(){
    if(recording||lock.current)return;
    setAuthBusy(true);
    try{const result=await clientRef.current?.auth.signOut({scope:'local'});if(result?.error)throw result.error;sessionRef.current=null;setSession(null);updateItems([]);setPending([]);setPendingChanges(0);setFeedback('');setSheet(null);setDraft('');setSelected(null);}
    catch(e){setError(errorText(e));}finally{setAuthBusy(false);}
  }
  const current=items.find(i=>i.id===selected);
  function edit(item:Item){
    setEditTitle(item.title);setEditContent(item.content);setEditArea(item.area);setEditType(item.type);setEditImportance(String(item.importance));setEditUrgency(String(item.urgency));
    const d=item.due_at?new Date(item.due_at):null;
    setEditDate(d?new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16):item.due_date||'');setEditing(true);
  }
  async function saveEdit(e:React.FormEvent){
    e.preventDefault();if(!current||!clientRef.current)return;
    if(!navigator.onLine){setError('Reconnect to edit details. Your changes are still in this form.');return;}
    setEditBusy(true);
    try{
      const factual=editType==='note'||editType==='reference';
      const {error}=await clientRef.current.from('items').update({title:editTitle.trim(),content:editContent,area:editArea,type:editType,
        due_at:!factual&&editDate.includes('T')?new Date(editDate).toISOString():null,due_date:!factual&&editDate&&!editDate.includes('T')?editDate:null,importance:factual?1:Number(editImportance),urgency:factual?1:Number(editUrgency)}).eq('id',current.id);
      if(error)throw error;await refresh();setEditing(false);setFeedback('Updated.');
    }catch(e){setError(errorText(e));}finally{setEditBusy(false);}
  }
  async function addSubtask(e:React.FormEvent){
    e.preventDefault();if(!current||!subTitle.trim()||!clientRef.current)return;
    setEditBusy(true);
    try{
      const {error}=await clientRef.current.from('items').insert({user_id:sessionRef.current!.user.id,type:'task',title:subTitle.trim(),area:current.area,parent_id:current.id,status:'active',importance:current.importance,urgency:current.urgency});
      if(error)throw error;setSubTitle('');await refresh();
    }catch(e){setError(errorText(e));}finally{setEditBusy(false);}
  }
  async function openItem(item:Item){
    const owner=sessionRef.current?.user.id,opened=new Date().toISOString();setSelected(item.id);
    if(owner){const next=itemsRef.current.map(row=>row.id===item.id?{...row,last_opened_at:opened}:row);updateItems(next);await putLocal('cache',{id:owner,items:next,lastTurn:lastTurnRef.current}).catch(()=>{});}
    if(clientRef.current&&navigator.onLine)void clientRef.current.from('items').update({last_opened_at:opened}).eq('id',item.id).eq('user_id',owner).then(({error})=>{if(error)setError('Could not update the opened time.');});
  }
  function row(item:Item){
    const due=dueLabel(item.due_at,item.due_date),subtasks=items.filter(i=>i.parent_id===item.id),stale=view==='today'&&unopenedForDay(item);
    return <article className={'item '+(stale?'stale-attention':'')} key={item.id}>
      {actionable(item)?<button className={'item-check '+(item.status==='completed'?'complete':'')} onClick={()=>void changeStatus(item)} aria-label={(item.status==='completed'?'Reopen ':'Complete ')+item.title}>{item.status==='completed'?<CheckCircle2/>:<Circle/>}</button>:<span className="item-check">{item.type==='note'?<FileText/>:<Bookmark/>}</span>}
      <button className="item-body" onClick={()=>void openItem(item)}>
        <div className="item-title">{item.title}</div>
        <div className="item-meta"><span>{item.area}</span><span aria-hidden>·</span>
          {due?<span className={dueTime(item)<Date.now()?'overdue':'due'}>{dueTime(item)<Date.now()?'Overdue · ':''}{due}</span>:<span>{actionable(item)?quadrant(item):item.type==='note'?'Note':'Reference'}</span>}
          {!!subtasks.length&&<span className="pill">{subtasks.filter(i=>i.status==='completed').length}/{subtasks.length} steps</span>}
        </div>
      </button><ChevronRight size={17} className="muted" aria-hidden/>
    </article>;
  }
  const personalItems=items.filter(i=>i.area!=='Work');
  const focusItems=attention(personalItems);
  const todayGroups=PERSONAL_AREAS.map(name=>({name,rows:focusItems.filter(item=>item.area===name)})).filter(group=>group.rows.length);
  const areaItems=personalItems.filter(i=>i.area===area&&i.status==='active'&&!i.parent_id).sort((a,b)=>b.created_at.localeCompare(a.created_at));
  const generalNotes=personalItems.filter(i=>i.status==='active'&&!i.parent_id&&(i.type==='note'||i.type==='reference')).sort((a,b)=>b.created_at.localeCompare(a.created_at));
  const completed=personalItems.filter(i=>i.status==='completed'&&!i.parent_id).sort((a,b)=>Date.parse(completionMoment(b))-Date.parse(completionMoment(a)));
  const completedFiltered=completed.filter(item=>!completedQuery.trim()||[item.title,item.content,item.area,item.type].join(' ').toLowerCase().includes(completedQuery.trim().toLowerCase()));
  const completedGroups=[...completedFiltered.reduce((map,item)=>{const key=completionDayKey(item),group=map.get(key)??{key,label:completionDayLabel(item),rows:[] as Item[]};group.rows.push(item);map.set(key,group);return map;},new Map<string,{key:string;label:string;rows:Item[]}>()).values()];
  const pendingCount=pending.length+pendingChanges;
  const liveNotes=thoughtLines(recording?liveTranscript:reviewDraft,interimTranscript);
  const loginForm=<form className="stack" onSubmit={e=>void signIn(e)}>
    <label><span className="field-label">Email</span><Input type="email" autoComplete="email" inputMode="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
    <label><span className="field-label">Password</span><Input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>
    {authMessage&&<p role="alert">{authMessage}</p>}
    <Button type="submit" disabled={authBusy||!online}>{authBusy?'Signing in…':'Sign in'}</Button>
  </form>;
  if(!session)return <main className="shell"><header className="app-header"><h1>Dylan’s Toolbox</h1></header><section className="auth-card"><ShieldCheck/><h2>Your private toolbox</h2><p className="muted">Access is restricted to the owner. Public signup is closed.</p>{ready?loginForm:<p className="loading">Checking access…</p>}</section></main>;
  if(settingPassword)return <main className="shell"><section className="auth-card"><h1>Set your Toolbox password</h1><p>Your private invitation has been verified.</p><form className="stack" onSubmit={async e=>{e.preventDefault();setAuthBusy(true);setAuthMessage('');try{const {error}=await clientRef.current!.auth.updateUser({password});if(error)throw error;setPassword('');setSettingPassword(false);}catch(e){setAuthMessage(errorText(e));}finally{setAuthBusy(false);}}}><label><span className="field-label">New password</span><Input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={e=>setPassword(e.target.value)}/></label><p className="muted">Use at least 12 characters.</p>{authMessage&&<p role="alert">{authMessage}</p>}<Button type="submit" disabled={authBusy||!online}>{authBusy?'Saving…':'Save password and open Toolbox'}</Button></form></section></main>;
  return <main className={'shell '+(view==='talk'&&(recording||reviewDraft)?'talk-focus':'')}>
    <header className="app-header"><div className="brand"><span className="brand-mark"><Box size={21}/></span><h1>Dylan’s Toolbox</h1></div>
      <Button variant="ghost" size="icon" aria-label="Account and app settings" onClick={()=>setSheet('account')}><Settings2/></Button></header>
    {!online&&<div className="notice"><WifiOff/><span>You’re offline. Captures stay on this device until you reconnect.</span></div>}
    {!!error&&<div className="notice error" role="alert"><span>{error}</span><Button variant="ghost" aria-label="Dismiss error" onClick={()=>setError('')}>×</Button></div>}
    {unsaved.filter(capture=>capture.user_id===session.user.id).map(capture=><section key={capture.id} className="auth-card stack" role="region" aria-label="Unsaved capture" style={{marginTop:12}}>
      <h2>{capture.audio?'Your recording needs saving':'Your thought needs saving'}</h2>
      <p>This copy is only in this window. Keep it open until you save or download a copy.</p>
      {capture.audio?<AudioPlayback blob={capture.audio}/>:<p className="detail-content">{capture.text}</p>}
      <CaptureDownload capture={capture}/>
      <Button variant="outline" onClick={()=>void queue(capture).catch(e=>setError(errorText(e)))}>Try saving again</Button>
    </section>)}
    {pendingCount>0&&<button className="notice" style={{width:'100%',textAlign:'left'}} onClick={()=>setSheet('pending')}><CloudUpload/><span>{busy?'Organizing your thoughts…':pendingCount+' '+(pendingCount===1?'capture or change is':'captures or changes are')+' waiting to sync'}</span><ChevronRight size={17}/></button>}
    <div aria-live="polite" aria-atomic="true">{feedback&&<p className="feedback">{feedback}</p>}</div>
    <Tabs value={view} onValueChange={setView}>
      <TabsContent value="today">
        <section className="intro"><p className="eyebrow">{today||'Your space to think'}</p><h2>A little less on your mind.</h2></section>
        <section className="attention"><div className="section-heading"><h2>Needs your attention</h2>{focusItems.length>0&&<span className="muted">{focusItems.length} for now</span>}</div>
          {!ready||loading&&!items.length?<p className="loading">Opening your toolbox…</p>:todayGroups.length?<div className="today-area-grid">{todayGroups.map(group=>{const Icon=areaIcons[group.name];return <section className="today-area-card" key={group.name}><div className="today-area-heading"><Icon/><div><h3>{group.name}</h3><span>{group.rows.length} {group.rows.length===1?'item':'items'}</span></div></div><div className="item-list">{group.rows.map(row)}</div></section>})}</div>:<div className="empty"><Sun/><h3>{session?'Nothing pressing right now.':'A clear place to start.'}</h3><p>{session?'Put down a thought whenever it comes. We’ll keep the rest out of your way.':'Sign in once to keep your thoughts private and available on your devices.'}</p>{!session&&<Button variant="ghost" onClick={()=>setSheet('account')}>Sign in<ChevronRight/></Button>}</div>}
          <p className="quiet-note">Only what matters now. Everything else has a place.</p>
        </section>
      </TabsContent>
      <TabsContent value="talk" className={recording||reviewDraft?'talk-session':''}>
        {!recording&&!reviewDraft&&<section className="intro"><p className="eyebrow">Your voice space</p><h2>Say what’s on your mind.</h2></section>}
        <section className={'capture-card '+(recording||reviewDraft?'expanded':'')} aria-label="Capture a thought">
          <h2>{recording?'I’m listening.':'Talk to your toolbox.'}</h2><p>{recording?'Take your time. Tap when you’re done.':'Share an idea, adjust a reminder, or tell me what you got done.'}</p>
          <Button className={'mic-button '+(recording?'recording':'')} onClick={()=>void microphone()} disabled={starting||!ready||busy&&!recording} aria-label={recording?'Stop recording to review':'Start voice capture'}>
            {starting?<LoaderCircle className="spinning"/>:recording?<Square fill="currentColor"/>:<Mic/>}
          </Button>
          <div className="capture-label" aria-live="polite">{recording?Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')+' · Tap when done':reviewDraft?'Ready when you are':'Tap to talk'}</div>
          {!recording&&!reviewDraft&&<div className="capture-secondary"><Button variant="ghost" onClick={()=>setSheet(session?'write':'account')}><PenLine/>Or type a thought</Button></div>}
        </section>
        {(recording||reviewDraft)&&<section className="live-review" aria-live="polite" aria-label="Orbit’s notes">
          <div className="section-heading"><h2>Orbit’s notes</h2><span className="muted">Nothing saved yet</span></div>
          {recording?<ul className="draft-notes live">{liveNotes.length?liveNotes.map((line,index)=><li className={index===liveNotes.length-1&&!!interimTranscript?'interim':''} key={index}>{line}</li>):<li className="interim">Start speaking. I’m taking notes.</li>}</ul>:<Textarea aria-label="Edit Orbit’s notes before saving" value={reviewDraft} onChange={e=>{setReviewDraft(e.target.value);setLiveTranscript(e.target.value);}} maxLength={30000}/>} 
          {!liveWordsAvailable&&recording&&<p className="muted">I’m still listening. Tap to review the recording when you finish.</p>}
          {recording?<p className="live-hint">If something is wrong, keep talking and correct it. Nothing is saved until you tap Done.</p>:<div className="review-actions"><Button onClick={()=>void approveReview()} disabled={!reviewDraft.trim()||busy}><Check/>Done</Button><Button variant="outline" onClick={()=>void microphone()} disabled={starting||busy}><Mic/>Keep talking</Button></div>}
        </section>}
        {!recording&&!reviewDraft&&<p className="quiet-note">Use Talk to put something away. Use AI when you want an actual conversation.</p>}
      </TabsContent>
      <TabsContent value="areas">
        <section className="intro"><p className="eyebrow">Safely put away</p><h2>{area||'Everything has a place.'}</h2><p className="muted">{area?'Tasks, notes, and references for '+area.toLowerCase()+'.':'Find something when you need it.'}</p></section>
        {area?<><Button variant="ghost" onClick={()=>setArea(null)}><ArrowLeft/>All areas</Button><div className="item-list" style={{marginTop:16}}>{areaItems.slice(0,limit).map(row)}</div>{!areaItems.length&&<div className="empty"><Folder/><h3>Room for your {area.toLowerCase()} thoughts.</h3><p>Speak naturally. We’ll file the right things here.</p></div>}{areaItems.length>limit&&<Button variant="ghost" onClick={()=>setLimit(limit+25)}>Show 25 more</Button>}</>:<><button className="general-notes-card" onClick={()=>setView('notes')}><StickyNote/><span><strong>General Notes</strong><small>{generalNotes.length} saved for later</small></span><ChevronRight/></button><div className="area-grid">{PERSONAL_AREAS.map(name=>{const Icon=areaIcons[name],count=personalItems.filter(i=>i.area===name&&i.status==='active'&&!i.parent_id).length;return <button key={name} className="area-button" onClick={()=>setArea(name)}><Icon/><span>{name}<small>{count} {count===1?'item':'items'}</small></span></button>;})}</div></>}
      </TabsContent>
      <TabsContent value="notes"><section className="intro"><p className="eyebrow">Keep without carrying</p><h2>General Notes</h2><p className="muted">Not a to-do. Just things that may matter later.</p></section><Button variant="ghost" onClick={()=>setView('areas')}><ArrowLeft/>Back to Areas</Button><div className="item-list" style={{marginTop:16}}>{generalNotes.slice(0,limit).map(row)}</div>{!generalNotes.length&&<div className="empty"><StickyNote/><h3>Nothing waiting here.</h3><p>Notes and references that are not actions will collect here automatically.</p></div>}{generalNotes.length>limit&&<Button variant="ghost" onClick={()=>setLimit(limit+25)}>Show 25 more</Button>}</TabsContent>
      <TabsContent value="completed"><section className="intro"><p className="eyebrow">Off your plate</p><h2>Done and dusted.</h2><p className="muted">Finished items, organized by when you finished them.</p></section><label className="completed-search"><Search/><Input aria-label="Search completed items" placeholder="Search finished items…" value={completedQuery} onChange={e=>setCompletedQuery(e.target.value)}/></label>
        {completedGroups.slice(0,limit).map((group,index)=><details className="completed-day" key={group.key} open={index===0}><summary><span>{group.label}</span><small>{group.rows.length} {group.rows.length===1?'item':'items'}</small></summary><div className="item-list">{group.rows.map(row)}</div></details>)}{!completedFiltered.length&&<div className="empty"><CheckCheck/><h3>{completed.length?'No finished items match that search.':'Your finished tasks will land here.'}</h3><p>{completed.length?'Try a different word.':'One small thing at a time.'}</p></div>}
        {completedGroups.length>limit&&<Button variant="ghost" onClick={()=>setLimit(limit+25)}>Show more dates</Button>}
      </TabsContent>
      <TabsContent value="ai"><section className="intro"><p className="eyebrow">Ask, plan, think out loud</p><h2>AI</h2><p className="muted">Have a conversation here. Type or use your voice.</p></section><section className="ai-panel"><div className="ai-thread">{aiHistory.map(turn=><div className="ai-exchange" key={turn.id}><div className="ai-user"><span>You</span><p>{turn.source_text}</p></div>{turn.turn_result?.reply&&<div className={'ai-orbit '+(turn.turn_result.needs_clarification?'question':'')}><span>{turn.turn_result.needs_clarification?'Orbit needs one detail':'Orbit'}</span><p>{turn.turn_result.reply}</p></div>}</div>)}{pending.filter(capture=>capture.channel==='ai').map(capture=><div className="ai-user pending" key={capture.id}><span>You · sending</span><p>{capture.text||'Voice message waiting to process'}</p></div>)}{!aiHistory.length&&!pending.some(capture=>capture.channel==='ai')&&<div className="empty"><MessageSquareText/><h3>Start a conversation.</h3><p>Ask a question, think through a plan, or talk something out.</p></div>}</div>{recording&&view==='ai'&&<div className="ai-live"><p>{liveTranscript}{interimTranscript&&<span> {interimTranscript}</span>}</p><Button type="button" variant="outline" onClick={()=>void microphone(undefined,'ai')}><Square fill="currentColor"/>Stop</Button></div>}<form className="ai-compose" onSubmit={e=>{e.preventDefault();void sendAiMessage().catch(e=>setError(errorText(e)));}}><Textarea aria-label="Message Orbit" placeholder="Message Orbit…" value={aiDraft} onChange={e=>setAiDraft(e.target.value)} maxLength={30000} disabled={recording}/><div><Button type="button" variant="outline" onClick={()=>void microphone(undefined,'ai')} disabled={starting||busy&&!recording}>{starting?<LoaderCircle className="spinning"/>:<Mic/>}{recording?'Stop':'Voice'}</Button><Button type="submit" disabled={!aiDraft.trim()||busy||recording}>Send</Button></div></form></section></TabsContent>
      <nav className="bottom-nav" aria-label="Main navigation"><TabsList><TabsTrigger value="today"><Sun/>Today</TabsTrigger><TabsTrigger value="talk"><Mic/>Talk</TabsTrigger><TabsTrigger value="areas"><Layers/>Areas</TabsTrigger><TabsTrigger value="completed"><CheckCheck/>Done</TabsTrigger><TabsTrigger value="ai"><MessageSquareText/>AI</TabsTrigger></TabsList></nav>
    </Tabs>
    <Sheet open={sheet!==null} onOpenChange={open=>{if(!open)setSheet(null);}}>
      <SheetContent side="bottom" className="detail-sheet">
        <SheetTitle>{sheet==='write'?'Put it down.':sheet==='pending'?'Saved on this device':session?'Your toolbox':'Your private toolbox'}</SheetTitle>
        <SheetDescription>{sheet==='write'?'One thought or a whole ramble. We’ll find the useful pieces.':sheet==='pending'?'These will retry while the app is open and connected.':session?'Your thoughts, your space.':'Sign in to save and sync your thoughts across devices.'}</SheetDescription>
        {sheet==='write'&&<form className="stack" onSubmit={e=>{e.preventDefault();void saveText().catch(e=>setError(errorText(e)));}}>
          <Textarea aria-label="Your thoughts" value={draft} onChange={e=>setDraft(e.target.value)} maxLength={30000} placeholder="Remind me to call Sam tomorrow. Also, the paint we liked was…" autoFocus/>
          <Button type="submit" disabled={!draft.trim()||busy}><Check/>Send to Toolbox</Button>
        </form>}
        {sheet==='pending'&&<div className="stack">
          {pending.map(p=><div key={p.id} className="auth-card" style={{marginTop:0,padding:16}}><h3>{p.channel==='ai'?'AI message':p.audio?'Voice capture':'Written capture'}</h3><p className="muted">{new Date(p.captured_at).toLocaleString()}</p>{p.text&&<p className="detail-content" style={{marginTop:8}}>{p.text}</p>}{p.audio&&<AudioPlayback blob={p.audio}/>}<CaptureDownload capture={p}/><p className="muted" style={{marginTop:10,fontSize:'.9rem'}}>{p.error||'Waiting to organize.'}</p></div>)}
          {pendingChanges>0&&<p>{pendingChanges} task changes waiting to sync.</p>}
          <Button disabled={busy||!online} onClick={()=>void sync()}>{busy?<LoaderCircle className="spinning"/>:<CloudUpload/>}{busy?'Processing…':'Retry now'}</Button>
        </div>}
        {sheet==='account'&&(session?<div className="stack">
          <p style={{overflowWrap:'anywhere'}}>{session.user.email}</p><p className="muted"><ShieldCheck size={17} style={{display:'inline',verticalAlign:'middle'}}/> Only your signed-in account can access your items.</p>
          <div className="auth-card" style={{marginTop:0}}><h3>Keep it on your Home Screen</h3><p className="muted" style={{marginTop:8}}>In iPhone Safari, tap Share, then Add to Home Screen. Open it once online before using it offline.</p></div>
          <PersonalRecovery client={clientRef.current!} onRestored={()=>location.reload()}/>
          <p className="muted">Reminders appear in the app when they’re due. This version doesn’t send push notifications.</p>
          {pendingCount>0&&<p className="muted">Your {pendingCount} pending captures or changes stay on this device and resume when you sign back into this account.</p>}
          {unsaved.length>0&&<p>Save or download your unsaved capture before leaving this window.</p>}
          <Button variant="outline" disabled={authBusy||busy||recording||unsaved.length>0} onClick={()=>void signOut()}><LogOut/>Sign out on this device</Button>
        </div>:loginForm)}
      </SheetContent>
    </Sheet>
    <Sheet open={!!current} onOpenChange={open=>{if(!open)setSelected(null);}}>
      <SheetContent side="bottom" className={editing?'detail-sheet item-editor':'detail-sheet'}>
        <SheetTitle>{editing?'Edit item':current?.title}</SheetTitle>
        <SheetDescription>{current?.area} · {current?.type}{current&&actionable(current)?' · '+quadrant(current):''}</SheetDescription>
        {current&&(editing?<form className="stack item-edit-form" onSubmit={e=>void saveEdit(e)}>
          <label className="item-edit-title"><span className="field-label">Title</span><Input required maxLength={180} value={editTitle} onChange={e=>setEditTitle(e.target.value)}/></label>
          <label><span className="field-label">Details</span><Textarea maxLength={12000} value={editContent} onChange={e=>setEditContent(e.target.value)}/></label>
          {(editType==='task'||editType==='reminder')&&<div className="item-edit-pair item-edit-schedule"><label><span className="field-label">Due day</span><Input type="date" value={editDate.split('T')[0]} onChange={e=>setEditDate(e.target.value?(e.target.value+(editDate.includes('T')?'T'+editDate.split('T')[1]:'')):'')}/></label><label><span className="field-label">Time</span><Input type="time" disabled={!editDate} value={editDate.split('T')[1]||''} onChange={e=>setEditDate(editDate.split('T')[0]+(e.target.value?'T'+e.target.value:''))}/></label></div>}
          <div className="item-edit-pair"><div><span className="field-label">Area</span><Select value={editArea} onValueChange={v=>setEditArea(v as Area)}><SelectTrigger aria-label="Area"><SelectValue/></SelectTrigger><SelectContent>{PERSONAL_AREAS.map(a=><SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent></Select></div>
            <div><span className="field-label">Type</span><Select value={editType} disabled={!!current.parent_id||items.some(i=>i.parent_id===current.id)} onValueChange={v=>setEditType(v as ItemType)}><SelectTrigger aria-label="Type"><SelectValue/></SelectTrigger><SelectContent>{['task','reminder','note','reference'].map(t=><SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div></div>
          {(editType==='task'||editType==='reminder')&&<div className="item-edit-pair"><Score label="Importance" value={editImportance} onChange={setEditImportance}/><Score label="Urgency" value={editUrgency} onChange={setEditUrgency}/></div>}
          <div className="item-edit-actions"><Button type="button" variant="ghost" onClick={()=>setEditing(false)}>Cancel</Button><Button type="submit" disabled={editBusy||!editTitle.trim()}>Save changes</Button></div>
        </form>:<div className="stack">
          {current.content&&<p className="detail-content">{current.content}</p>}
          {(current.due_at||current.due_date)&&<p className="due">{dueLabel(current.due_at,current.due_date)}</p>}
          <Button variant="outline" disabled={busy||recording||starting} onClick={()=>void microphone(current.id)}><Mic/>Talk about this item</Button>
          {actionable(current)&&<Button onClick={()=>void changeStatus(current)}>{current.status==='completed'?'Reopen task':'Mark complete'}<Check/></Button>}
          {items.some(i=>i.parent_id===current.id)&&<section className="connected-steps"><div className="section-heading"><h3>Connected steps</h3><span className="muted">In a useful order</span></div><div className="item-list">{items.filter(i=>i.parent_id===current.id).map(row)}</div></section>}
          {current.type==='task'&&!current.parent_id&&current.status==='active'&&<form onSubmit={e=>void addSubtask(e)} style={{display:'flex',gap:8}}><Input aria-label="New subtask" placeholder="Add a small step…" value={subTitle} maxLength={180} onChange={e=>setSubTitle(e.target.value)}/><Button type="submit" variant="outline" disabled={editBusy||!online||!subTitle.trim()}>Add</Button></form>}
          <Button variant="outline" onClick={()=>edit(current)}><PenLine/>Edit details</Button>
          {current.source_text&&<details><summary className="muted">Original capture</summary><p className="detail-source">{current.source_text}</p></details>}
        </div>)}
      </SheetContent>
    </Sheet>
  </main>;
}
function Score({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}){
  return <div><span className="field-label">{label}</span><Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label}><SelectValue/></SelectTrigger><SelectContent>{[1,2,3,4,5].map(n=><SelectItem value={String(n)} key={n}>{n} · {['Low','Mild','Moderate','High','Very high'][n-1]}</SelectItem>)}</SelectContent></Select></div>;
}
function AudioPlayback({blob}:{blob:Blob}){
  const [url,setUrl]=useState('');
  useEffect(()=>{const value=URL.createObjectURL(blob);setUrl(value);return()=>URL.revokeObjectURL(value);},[blob]);
  return url?<audio controls src={url} style={{width:'100%',marginTop:12}}/>:null;
}
function CaptureDownload({capture}:{capture:Capture}){
  const [url,setUrl]=useState('');
  useEffect(()=>{const value=URL.createObjectURL(capture.audio??new Blob([capture.text??''],{type:'text/plain'}));setUrl(value);return()=>URL.revokeObjectURL(value);},[capture]);
  const extension=capture.audio?(capture.audio.type.includes('mp4')?'m4a':capture.audio.type.includes('ogg')?'ogg':'webm'):'txt';
  return url?<a href={url} download={'toolbox-'+capture.id+'.'+extension} style={{display:'inline-block',padding:'12px 0',textDecoration:'underline',fontWeight:600}}>{capture.audio?'Download recording':'Download thought'}</a>:null;
}

