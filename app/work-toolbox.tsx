'use client';

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {Session,SupabaseClient} from '@supabase/supabase-js';
import {AlertTriangle,BriefcaseBusiness,Check,CheckCircle2,ChevronRight,Clock3,Eye,History,LoaderCircle,Mic,PenLine,RotateCcw,Send,Sparkles,Square,UserRound,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {getSupabase} from '@/lib/supabase';
import {publicConfig,workCaptureUrl} from '@/lib/public-config';
import {appendSpeech} from '@/lib/live-speech';
import {speakReply,stopSpeaking} from '@/lib/speech';
import {dueLabel} from '@/lib/items';
import {normalizeWorkCaseNumbers} from '@/lib/work-context';
import type {BallOwner,WorkCase,WorkCommitReceipt,WorkEvent,WorkPreviewReceipt,WorkProposal,WorkState} from '@/lib/work-types';
import './work-toolbox.css';

type SpeechResultLike={isFinal:boolean;0:{transcript:string};length:number};
type SpeechEventLike={resultIndex:number;results:ArrayLike<SpeechResultLike>};
type SpeechRecognitionLike={continuous:boolean;interimResults:boolean;lang:string;onresult:((event:SpeechEventLike)=>void)|null;onerror:(()=>void)|null;onend:(()=>void)|null;start:()=>void;stop:()=>void;abort:()=>void};
type SpeechRecognitionWindow=Window&{SpeechRecognition?:new()=>SpeechRecognitionLike;webkitSpeechRecognition?:new()=>SpeechRecognitionLike};
type WorkAnswer={kind:'work_answer';turn_id:string;answer:string;reply:string};
type WorkResponse={kind?:'work_preview'|'work_commit'|'work_answer';turn_id?:string;revision?:number;preview?:WorkPreviewReceipt['preview'];answer?:string;reply?:string;case_ids?:string[];cases?:WorkCase[];discarded?:boolean;error?:string};

type SectionKey=WorkState|'done';
type WorkSuccess={reply:string;caseId:string|null};

const groups:{state:WorkState;label:string;help:string;icon:typeof Check}[]=[
  {state:'todo',label:'To Do',help:'The ball is with you.',icon:Check},
  {state:'waiting',label:'Waiting on Response',help:'You made the request. The next move is theirs.',icon:Clock3},
  {state:'watching',label:'Watching',help:'Nothing to do yet. Keep an eye on the file.',icon:Eye},
  {state:'follow_up',label:'Follow-Ups',help:'Circle back when the time comes.',icon:RotateCcw},
];
const stateLabel:Record<WorkState,string>={todo:'To Do',waiting:'Waiting on Response',watching:'Watching',follow_up:'Follow-Up'};
const errorText=(e:unknown)=>e instanceof Error?e.message:'Something went wrong. Please try again.';

function ballLabel(owner:BallOwner,withWho:string|null){
  if(owner==='me')return 'Ball: You';
  if(owner==='other')return 'Ball: '+(withWho||'Someone else');
  if(owner==='watching')return 'Watching';
  return 'Closed';
}
function dateLabel(date:string|null){
  if(!date)return null;
  return new Date(date+'T12:00:00').toLocaleDateString([],{month:'short',day:'numeric',year:new Date(date+'T12:00:00').getFullYear()!==new Date().getFullYear()?'numeric':undefined});
}
function followUpLabel(item:Pick<WorkCase,'follow_up_at'|'follow_up_date'>){return dueLabel(item.follow_up_at,item.follow_up_date);}
function dueMoment(item:Pick<WorkCase,'follow_up_at'|'follow_up_date'>){return item.follow_up_at?Date.parse(item.follow_up_at):item.follow_up_date?new Date(item.follow_up_date+'T23:59:59').getTime():Infinity;}
function attentionReason(item:WorkCase,now=Date.now()){
  if(item.status!=='active')return null;
  if(dueMoment(item)<=now)return 'Follow-up due';
  if(item.ball_owner==='me')return 'Your move';
  if(item.closing_date){const close=new Date(item.closing_date+'T23:59:59').getTime();if(close>=now&&close<=now+2*86400000)return 'Closing soon';}
  if((item.workflow_state==='waiting'||item.workflow_state==='watching')&&!item.follow_up_at&&!item.follow_up_date&&Date.parse(item.last_event_at)<=now-3*86400000)return 'No follow-up set';
  return null;
}

export default function WorkToolbox(){
  const [session,setSession]=useState<Session|null>(null),[ready,setReady]=useState(false);
  const [section,setSection]=useState<SectionKey>('todo'),[success,setSuccess]=useState<WorkSuccess|null>(null);
  const [cases,setCases]=useState<WorkCase[]>([]),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
  const [reply,setReply]=useState(''),[error,setError]=useState('');
  const [draft,setDraft]=useState(''),[recording,setRecording]=useState(false),[starting,setStarting]=useState(false),[seconds,setSeconds]=useState(0);
  const [liveTranscript,setLiveTranscript]=useState(''),[interim,setInterim]=useState(''),[pendingAudio,setPendingAudio]=useState<Blob|null>(null);
  const [wizard,setWizard]=useState<WorkPreviewReceipt|null>(null),[wizardIndex,setWizardIndex]=useState(0),[correcting,setCorrecting]=useState(false),[correction,setCorrection]=useState('');
  const [selectedId,setSelectedId]=useState<string|null>(null),[events,setEvents]=useState<WorkEvent[]>([]),[eventsLoading,setEventsLoading]=useState(false),[focusCaseId,setFocusCaseId]=useState<string|null>(null);
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[authBusy,setAuthBusy]=useState(false);
  const clientRef=useRef<SupabaseClient|null>(null),sessionRef=useRef<Session|null>(null),recognition=useRef<SpeechRecognitionLike|null>(null),recorder=useRef<MediaRecorder|null>(null);
  const recTimer=useRef<ReturnType<typeof setInterval>|null>(null),liveRef=useRef(''),interimRef=useRef('');
  const captureRef=useRef<HTMLElement|null>(null);

  const refresh=useCallback(async()=>{
    const client=clientRef.current,owner=sessionRef.current?.user.id;if(!client||!owner||!navigator.onLine)return;
    setLoading(true);
    try{
      const {data,error}=await client.from('work_cases').select('*').eq('user_id',owner).order('last_event_at',{ascending:false}).limit(500);
      if(error)throw error;setCases((data??[]) as WorkCase[]);
    }catch(e){setError(errorText(e));}finally{setLoading(false);}
  },[]);

  const loadEvents=useCallback(async(caseId:string)=>{
    const client=clientRef.current;if(!client)return;setEventsLoading(true);
    try{const {data,error}=await client.from('work_events').select('*').eq('case_id',caseId).order('occurred_at',{ascending:false}).limit(100);if(error)throw error;setEvents((data??[]) as WorkEvent[]);}
    catch(e){setError(errorText(e));}finally{setEventsLoading(false);}
  },[]);

  const recoverWizard=useCallback(async()=>{
    const client=clientRef.current,owner=sessionRef.current?.user.id;if(!client||!owner||!navigator.onLine)return;
    try{
      const {data,error}=await client.from('items').select('id,turn_result,created_at').eq('user_id',owner).eq('type','capture').eq('area','Work').eq('status','pending').order('created_at',{ascending:false}).limit(10);
      if(error)throw error;
      const pending=(data??[]).find(row=>row.turn_result&&typeof row.turn_result==='object'&&(row.turn_result as {kind?:string}).kind==='work_preview');
      if(!pending)return;
      const stored=pending.turn_result as {kind:'work_preview';revision:number;preview:WorkPreviewReceipt['preview']};
      setWizard(current=>current??{kind:'work_preview',turn_id:pending.id,revision:stored.revision,preview:stored.preview});
    }catch(e){setError(errorText(e));}
  },[]);

  useEffect(()=>{
    let unsubscribe:(()=>void)|undefined;let dead=false;
    getSupabase().then(async client=>{
      if(dead)return;clientRef.current=client;
      const accept=async(next:Session|null)=>{
        if(next){const {data:allowed,error}=await client.rpc('toolbox_can_access');if(error||allowed!==true)next=null;}
        sessionRef.current=next;setSession(next);setReady(true);if(next){void refresh();void recoverWizard();}else setCases([]);
      };
      const {data}=await client.auth.getSession();await accept(data.session);
      const auth=client.auth.onAuthStateChange((_event,next)=>setTimeout(()=>void accept(next),0));unsubscribe=()=>auth.data.subscription.unsubscribe();
    }).catch(e=>{setError(errorText(e));setReady(true);});
    return()=>{dead=true;unsubscribe?.();recognition.current?.abort();if(recorder.current?.state==='recording')recorder.current.stop();stopSpeaking();};
  },[refresh,recoverWizard]);
  useEffect(()=>{const wake=()=>void refresh();const timer=setInterval(wake,30000);window.addEventListener('focus',wake);return()=>{clearInterval(timer);window.removeEventListener('focus',wake);};},[refresh]);
  useEffect(()=>{if(selectedId)void loadEvents(selectedId);else setEvents([]);},[selectedId,loadEvents]);

  async function signIn(e:React.FormEvent){
    e.preventDefault();setAuthBusy(true);setError('');
    try{
      const client=clientRef.current??await getSupabase();clientRef.current=client;
      const result=await client.auth.signInWithPassword({email,password});if(result.error)throw result.error;
      const {data:allowed,error}=await client.rpc('toolbox_can_access');if(error||allowed!==true){await client.auth.signOut({scope:'local'});throw new Error('This toolbox is private. Only its owner can sign in.');}
      setPassword('');
    }catch(e){setError(errorText(e));}finally{setAuthBusy(false);}
  }

  async function workRequest(form:FormData){
    const client=clientRef.current;if(!client)throw new Error('Work is not connected yet.');
    const {data}=await client.auth.getSession();if(!data.session)throw new Error('Please sign in again.');
    const response=await fetch(workCaptureUrl,{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token,apikey:publicConfig.key},body:form,signal:AbortSignal.timeout(190000)});
    const result=await response.json() as WorkResponse;
    return {response,result};
  }

  function openWizard(receipt:WorkPreviewReceipt){
    setWizard(receipt);setWizardIndex(0);setCorrecting(false);setCorrection('');setReply('');
  }

  async function sendPreview(text?:string,audio?:Blob,focusOverride?:string|null){
    const normalized=text?normalizeWorkCaseNumbers(text.trim()):'';if(!normalized&&!audio)return;
    setSuccess(null);setBusy(true);setError('');setReply('');
    try{
      const form=new FormData();form.set('mode','preview');form.set('id',crypto.randomUUID());form.set('captured_at',new Date().toISOString());form.set('time_zone',Intl.DateTimeFormat().resolvedOptions().timeZone);
      const focus=focusOverride===undefined?focusCaseId:focusOverride;if(focus)form.set('focus_case_id',focus);
      if(normalized)form.set('text',normalized);if(audio)form.set('audio',audio,'work-recording');
      const {response,result}=await workRequest(form);
      if(!response.ok)throw new Error(result.error||'Could not review that Work update.');
      if(result.kind==='work_preview'){openWizard(result as WorkPreviewReceipt);setDraft('');setLiveTranscript('');setInterim('');setPendingAudio(null);return;}
      if(result.kind==='work_answer'){
        const answer=(result as WorkAnswer).answer;setReply(answer);speakReply(answer);setDraft('');setLiveTranscript('');setInterim('');setPendingAudio(null);return;
      }
      throw new Error('Orbit returned an unexpected Work response.');
    }catch(e){setError(errorText(e));if(text)setDraft(normalized);if(audio)setPendingAudio(audio);}finally{setBusy(false);}
  }

  async function reviseWizard(){
    if(!wizard||!correction.trim())return;setBusy(true);setError('');
    try{
      const form=new FormData();form.set('mode','revise');form.set('id',wizard.turn_id);form.set('correction',correction.trim());
      const {response,result}=await workRequest(form);if(!response.ok)throw new Error(result.error||'Could not revise that draft.');
      if(result.kind==='work_preview'){openWizard(result as WorkPreviewReceipt);return;}
      if(result.kind==='work_answer'){setWizard(null);setReply((result as WorkAnswer).answer);return;}
      throw new Error('Orbit returned an unexpected revision.');
    }catch(e){setError(errorText(e));}finally{setBusy(false);}
  }

  async function commitWizard(){
    if(!wizard)return;setBusy(true);setError('');
    try{
      const form=new FormData();form.set('mode','commit');form.set('id',wizard.turn_id);
      const {response,result}=await workRequest(form);
      if(response.status===409&&result.kind==='work_preview'&&result.preview){openWizard(result as WorkPreviewReceipt);setError(result.error||'A file changed; review the refreshed draft.');return;}
      if(!response.ok)throw new Error(result.error||'Could not save the confirmed Work update.');
      if(result.kind!=='work_commit')throw new Error('Orbit returned an unexpected save response.');
      const saved=result as WorkCommitReceipt;setWizard(null);setReply('');setSuccess({reply:saved.reply,caseId:saved.case_ids[0]??null});speakReply(saved.reply);if(saved.case_ids[0])setFocusCaseId(saved.case_ids[0]);await refresh();if(selectedId&&saved.case_ids.includes(selectedId))await loadEvents(selectedId);
    }catch(e){setError(errorText(e));}finally{setBusy(false);}
  }

  async function discardWizard(){
    if(!wizard){setWizard(null);return;}setBusy(true);
    try{const form=new FormData();form.set('mode','discard');form.set('id',wizard.turn_id);await workRequest(form);setWizard(null);setCorrecting(false);setCorrection('');}
    catch(e){setError(errorText(e));}finally{setBusy(false);}
  }

  async function confirmWizardStep(){
    if(!wizard)return;
    if(wizardIndex<wizard.preview.proposals.length-1){setWizardIndex(index=>index+1);setCorrecting(false);setCorrection('');return;}
    await commitWizard();
  }

  async function microphone(){
    if(recording){if(recognition.current)recognition.current.stop();else recorder.current?.stop();return;}
    if(!sessionRef.current){setError('Sign in before using Work voice capture.');return;}
    stopSpeaking();setStarting(true);setError('');setReply('');
    const Recognition=(window as SpeechRecognitionWindow).SpeechRecognition??(window as SpeechRecognitionWindow).webkitSpeechRecognition;
    if(Recognition){
      liveRef.current='';interimRef.current='';setLiveTranscript('');setInterim('');setSeconds(0);
      const live=new Recognition();recognition.current=live;live.continuous=true;live.interimResults=true;live.lang='en-US';
      live.onresult=event=>{
        let final='',temp='';for(let i=event.resultIndex;i<event.results.length;i++){const words=event.results[i][0]?.transcript??'';if(event.results[i].isFinal)final=appendSpeech(final,words);else temp=appendSpeech(temp,words);}
        if(final){liveRef.current=appendSpeech(liveRef.current,final);setLiveTranscript(normalizeWorkCaseNumbers(liveRef.current));}
        interimRef.current=temp;setInterim(temp);
      };
      live.onerror=()=>setError('I lost the live transcript. Tap again or type the update.');
      live.onend=()=>{
        recognition.current=null;if(recTimer.current)clearInterval(recTimer.current);setRecording(false);
        const complete=normalizeWorkCaseNumbers(appendSpeech(liveRef.current,interimRef.current));setLiveTranscript(complete);setInterim('');interimRef.current='';
        if(complete)void sendPreview(complete);else setError('I didn’t catch any words. Try again.');
      };
      try{live.start();setRecording(true);let elapsed=0;recTimer.current=setInterval(()=>{elapsed++;setSeconds(elapsed);if(elapsed>=300)live.stop();},1000);}catch{recognition.current=null;setError('The microphone could not start. Check Safari’s microphone permission.');}
      finally{setStarting(false);}return;
    }
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){setError('Voice recording is not available here. Type the Work update instead.');setStarting(false);return;}
    let stream:MediaStream|undefined;
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:true});
      const mime=['audio/mp4','audio/webm;codecs=opus','audio/webm'].find(type=>MediaRecorder.isTypeSupported(type));
      const rec=new MediaRecorder(stream,mime?{mimeType:mime}:undefined),chunks:Blob[]=[];recorder.current=rec;setSeconds(0);
      rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      rec.onstop=()=>{if(recTimer.current)clearInterval(recTimer.current);stream?.getTracks().forEach(track=>track.stop());setRecording(false);const audio=new Blob(chunks,{type:rec.mimeType||mime||'audio/mp4'});if(audio.size)void sendPreview(undefined,audio);else setError('No audio was recorded.');};
      rec.start(1000);setRecording(true);let elapsed=0;recTimer.current=setInterval(()=>{elapsed++;setSeconds(elapsed);if(elapsed>=300&&rec.state==='recording')rec.stop();},1000);
    }catch(e){stream?.getTracks().forEach(track=>track.stop());setError(e instanceof DOMException&&e.name==='NotAllowedError'?'Microphone access is off. Allow it in Safari’s website settings.':errorText(e));}
    finally{setStarting(false);}
  }

  function openCase(item:WorkCase){setSelectedId(item.id);setFocusCaseId(item.id);}
  function talkAbout(item:WorkCase){setFocusCaseId(item.id);setSelectedId(null);setTimeout(()=>captureRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),0);}

  const active=cases.filter(item=>item.status==='active'),completed=cases.filter(item=>item.status==='completed');
  const sectionOptions=[
    ...groups.map(group=>({...group,key:group.state as SectionKey,count:active.filter(item=>item.workflow_state===group.state).length})),
    {key:'done' as SectionKey,label:'Done',help:'Closed and completed Work files.',icon:CheckCircle2,count:completed.length},
  ];
  const currentSection=sectionOptions.find(option=>option.key===section)??sectionOptions[0];
  const sectionRows=section==='done'?completed:active.filter(item=>item.workflow_state===section);
  const attention=useMemo(()=>active.map(item=>({item,reason:attentionReason(item)})).filter((row):row is {item:WorkCase;reason:string}=>!!row.reason).sort((a,b)=>{
    const rank=(reason:string)=>reason==='Follow-up due'?0:reason==='Your move'?1:reason==='Closing soon'?2:3;return rank(a.reason)-rank(b.reason)||Date.parse(b.item.last_event_at)-Date.parse(a.item.last_event_at);
  }).slice(0,5),[active]);
  const selected=cases.find(item=>item.id===selectedId)??null;
  const currentProposal:WorkProposal|undefined=wizard?.preview.proposals[wizardIndex];
  const SectionIcon=currentSection.icon;

  if(!ready)return <main className="work-toolbox"><p className="work-loading">Opening Work…</p></main>;
  if(!session)return <main className="work-toolbox"><section className="work-login"><BriefcaseBusiness/><h1>Work</h1><p>Sign in to open your private Work command center.</p><form onSubmit={e=>void signIn(e)}><label>Email<Input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Password<Input type="password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<p className="work-error">{error}</p>}<Button type="submit" disabled={authBusy}>{authBusy?<LoaderCircle className="spinning"/>:'Sign in'}</Button></form></section></main>;

  return <main className="work-toolbox">
    <header className="work-header"><div><p className="work-eyebrow">Dylan’s Toolbox</p><h1>Work</h1><p>Tell Orbit what happened. Confirm what it understood. Let it remember the rest.</p></div><div className="work-header-actions"><Button variant="outline" onClick={()=>void sendPreview('What actually needs me right now? Give me a concise briefing of my Work files, overdue follow-ups, and anything becoming time-sensitive.')} disabled={busy}><Sparkles/>Brief me</Button><span className="work-header-icon"><BriefcaseBusiness/></span></div></header>
    {error&&<div className="work-error" role="alert">{error}</div>}
    {reply&&<aside className="work-orbit"><strong>Orbit</strong><p>{reply}</p></aside>}

    {attention.length>0&&<section className="work-attention"><div className="work-attention-heading"><AlertTriangle/><div><h2>Needs attention</h2><p>Only the things most likely to need you.</p></div></div><div className="work-attention-list">{attention.map(({item,reason})=><button type="button" key={item.id} onClick={()=>openCase(item)}><span><strong>{item.case_number||item.title}</strong><small>{reason}{item.next_action?' · '+item.next_action:''}</small></span><ChevronRight/></button>)}</div></section>}

    <section className="work-capture" ref={captureRef}>
      <div className="work-capture-heading"><div><h2>{recording?'I’m listening.':busy?'Orbit is organizing it…':'Update or ask Work'}</h2><p>{focusCaseId?'Current file context: '+(cases.find(item=>item.id===focusCaseId)?.case_number||cases.find(item=>item.id===focusCaseId)?.title||'selected file')+'. ':' '}Talk naturally. Nothing changes until you confirm the wizard.</p></div>{focusCaseId&&<button type="button" className="work-focus-clear" onClick={()=>setFocusCaseId(null)}>Clear file</button>}</div>
      <Button className={'work-mic '+(recording?'recording':'')} onClick={()=>void microphone()} disabled={starting||busy&&!recording}>{starting||busy&&!recording?<LoaderCircle className="spinning"/>:recording?<Square fill="currentColor"/>:<Mic/>}</Button>
      <p className="work-mic-label">{recording?Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')+' · Tap when done':busy?'Building your review…':'Tap to talk'}</p>
      {recording&&(liveTranscript||interim)&&<div className="work-live">{normalizeWorkCaseNumbers(liveTranscript)}{interim&&<span> {interim}</span>}</div>}
      {!recording&&!busy&&<form className="work-type" onSubmit={e=>{e.preventDefault();void sendPreview(draft);}}><Textarea placeholder="Tell Orbit what happened, or ask where a file stands…" value={draft} onChange={e=>setDraft(e.target.value)} maxLength={30000}/><Button type="submit" disabled={!draft.trim()}><PenLine/>Review with Orbit</Button></form>}
      {pendingAudio&&!busy&&<Button variant="outline" onClick={()=>void sendPreview(undefined,pendingAudio)}>Retry saved recording</Button>}
    </section>

    <section className="work-board" aria-live="polite">
      <section className={'work-section-view section-'+section}>
        <div className="work-section-heading"><span><SectionIcon/></span><div><p className="work-section-kicker">{currentSection.count} {currentSection.count===1?'item':'items'}</p><h2>{currentSection.label}</h2><p>{currentSection.help}</p></div></div>
        {sectionRows.length?<div className="work-list">{sectionRows.map(item=><button type="button" className="work-item" key={item.id} onClick={()=>openCase(item)}><div className="work-item-main"><h3>{item.case_number?item.case_number+' · ':''}{item.title.replace(/^G\d{2}-\d{4}\s*[·—-]?\s*/,'')}</h3>{item.current_situation&&<p>{item.current_situation}</p>}{item.status==='active'&&<div className="work-meta"><span>{ballLabel(item.ball_owner,item.ball_with)}</span>{followUpLabel(item)&&<span>{followUpLabel(item)}</span>}{item.closing_date&&<span>Close {dateLabel(item.closing_date)}</span>}</div>}</div><ChevronRight className="work-chevron"/></button>)}</div>:<div className="work-section-empty"><span><SectionIcon/></span><h3>Nothing here right now.</h3><p>{section==='todo'?'You are caught up on things that need your action.':section==='waiting'?'No one owes you a response right now.':section==='watching'?'No files are sitting in watch mode.':section==='follow_up'?'No follow-ups are waiting for you.':'Nothing has been marked done yet.'}</p></div>}
        {loading&&<p className="work-loading"><LoaderCircle className="spinning"/> Refreshing Work…</p>}
      </section>
    </section>

    <nav className="work-bottom-tabs" aria-label="Work sections">
      {sectionOptions.map(option=>{const Icon=option.icon;return <button type="button" key={option.key} data-section={option.key} className={section===option.key?'active':''} aria-current={section===option.key?'page':undefined} onClick={()=>setSection(option.key)}><span className="work-tab-icon"><Icon/><b>{option.count}</b></span><span>{option.label==='Waiting on Response'?'Waiting':option.label==='Follow-Ups'?'Follow-Ups':option.label}</span></button>;})}
    </nav>

    {success&&<div className="work-overlay work-success-overlay" role="dialog" aria-modal="true" aria-label="Work update saved"><section className="work-success-card"><span className="work-success-check"><Check/></span><h2>All Set!</h2><p>{success.reply||'Your update has been saved. Orbit is keeping track of it.'}</p><Button onClick={()=>{setSuccess(null);setTimeout(()=>captureRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),0);}}>Add Another Update</Button>{success.caseId&&<Button variant="outline" onClick={()=>{setSuccess(null);setSelectedId(success.caseId);setFocusCaseId(success.caseId);}}>View File</Button>}</section></div>}

    {wizard&&currentProposal&&<div className="work-overlay" role="dialog" aria-modal="true" aria-label="Confirm Work update"><section className="work-wizard"><div className="work-wizard-top"><div><p className="work-step">Check {wizardIndex+1} of {wizard.preview.proposals.length}</p><h2>{wizard.preview.headline||'Check what Orbit understood'}</h2></div><Button size="icon" variant="ghost" aria-label="Cancel draft" onClick={()=>void discardWizard()} disabled={busy}><X/></Button></div><div className="work-wizard-file"><span className="work-case-badge">{currentProposal.case_number||'Work item'}</span><h3>{currentProposal.title}</h3><div className="work-wizard-chips"><span>{stateLabel[currentProposal.workflow_state]}</span><span>{ballLabel(currentProposal.ball_owner,currentProposal.ball_with)}</span>{currentProposal.status==='completed'&&<span>Completed</span>}</div></div><dl className="work-wizard-details"><div><dt>Current situation</dt><dd>{currentProposal.current_situation||'—'}</dd></div><div><dt>Next action</dt><dd>{currentProposal.next_action||'Nothing specific yet'}</dd></div><div><dt>When to care again</dt><dd>{dueLabel(currentProposal.follow_up_at,currentProposal.follow_up_date)||'No follow-up set'}</dd></div>{currentProposal.closing_date&&<div><dt>Closing</dt><dd>{dateLabel(currentProposal.closing_date)}</dd></div>}<div><dt>Timeline entry</dt><dd>{currentProposal.event_summary}</dd></div></dl><div className="work-wizard-question"><strong>{currentProposal.confirmation_question}</strong></div>{!correcting?<div className="work-wizard-actions"><Button className="work-confirm-yes" onClick={()=>void confirmWizardStep()} disabled={busy}>{busy?<LoaderCircle className="spinning"/>:<><Check/>Yes, that’s right</>}</Button><Button variant="outline" onClick={()=>setCorrecting(true)} disabled={busy}><X/>No, change it</Button></div>:<div className="work-correction"><label>What did Orbit get wrong, or what should be different?<Textarea autoFocus value={correction} onChange={e=>setCorrection(e.target.value)} placeholder="Example: I’m waiting on Sarah, not Mike, and I don’t need to follow up until Tuesday." maxLength={5000}/></label><div className="work-wizard-actions"><Button onClick={()=>void reviseWizard()} disabled={busy||!correction.trim()}>{busy?<LoaderCircle className="spinning"/>:<><Send/>Fix the draft</>}</Button><Button variant="outline" onClick={()=>{setCorrecting(false);setCorrection('');}} disabled={busy}>Back</Button></div></div>}<p className="work-wizard-note">No Work file changes are saved until every check is confirmed.</p></section></div>}

    {selected&&<div className="work-overlay" role="dialog" aria-modal="true" aria-label="Work file details"><section className="work-detail"><div className="work-detail-top"><div><p className="work-step">Work file</p><h2>{selected.case_number||selected.title}</h2>{selected.case_number&&<p>{selected.title.replace(/^G\d{2}-\d{4}\s*[·—-]?\s*/,'')}</p>}</div><Button size="icon" variant="ghost" aria-label="Close file" onClick={()=>setSelectedId(null)}><X/></Button></div><div className="work-wizard-chips"><span>{selected.status==='completed'?'Completed':stateLabel[selected.workflow_state]}</span><span>{ballLabel(selected.ball_owner,selected.ball_with)}</span>{attentionReason(selected)&&<span className="attention-chip">{attentionReason(selected)}</span>}</div><dl className="work-detail-grid"><div><dt>Current situation</dt><dd>{selected.current_situation||'No situation recorded yet.'}</dd></div><div><dt>Next action</dt><dd>{selected.next_action||'No next action recorded.'}</dd></div><div><dt>Follow-up</dt><dd>{followUpLabel(selected)||'None set'}</dd></div><div><dt>Closing</dt><dd>{dateLabel(selected.closing_date)||'Not recorded'}</dd></div></dl><div className="work-detail-actions"><Button onClick={()=>talkAbout(selected)}><Mic/>Talk about this file</Button>{selected.status==='active'&&<Button variant="outline" onClick={()=>{setSelectedId(null);void sendPreview((selected.case_number||selected.title)+' is completely done. Mark the whole file completed.',undefined,selected.id);}}><CheckCircle2/>Mark file done</Button>}</div><section className="work-timeline"><div className="work-timeline-title"><History/><div><h3>Timeline</h3><p>What has happened on this file.</p></div></div>{eventsLoading?<p className="work-loading"><LoaderCircle className="spinning"/>Loading history…</p>:events.length?<div className="work-timeline-list">{events.map(event=><article key={event.id}><span></span><div><time>{new Date(event.occurred_at).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</time><p>{event.summary}</p></div></article>)}</div>:<p className="work-empty">No timeline entries yet.</p>}</section></section></div>}
  </main>;
}
