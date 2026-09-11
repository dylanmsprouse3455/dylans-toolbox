'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import type {Session,SupabaseClient} from '@supabase/supabase-js';
import {BriefcaseBusiness,Check,CheckCircle2,Clock3,Eye,LoaderCircle,Mic,PenLine,RotateCcw,Send,Square} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {getSupabase} from '@/lib/supabase';
import {captureUrl,publicConfig} from '@/lib/public-config';
import {appendSpeech} from '@/lib/live-speech';
import {speakReply,stopSpeaking} from '@/lib/speech';
import {dueLabel,type Item} from '@/lib/items';
import type {TurnReceipt} from '@/lib/local';
import {normalizeWorkCaseNumbers,workContent,workState,type WorkState} from '@/lib/work-context';
import './work-toolbox.css';

type SpeechResultLike={isFinal:boolean;0:{transcript:string};length:number};
type SpeechEventLike={resultIndex:number;results:ArrayLike<SpeechResultLike>};
type SpeechRecognitionLike={continuous:boolean;interimResults:boolean;lang:string;onresult:((event:SpeechEventLike)=>void)|null;onerror:(()=>void)|null;onend:(()=>void)|null;start:()=>void;stop:()=>void;abort:()=>void};
type SpeechRecognitionWindow=Window&{SpeechRecognition?:new()=>SpeechRecognitionLike;webkitSpeechRecognition?:new()=>SpeechRecognitionLike};

const groups:{state:WorkState;label:string;help:string;icon:typeof Check}[]=[
  {state:'todo',label:'To Do',help:'Things you need to handle.',icon:Check},
  {state:'waiting',label:'Waiting on Response',help:'You made the request. The next move is theirs.',icon:Clock3},
  {state:'watching',label:'Watching',help:'Keep an eye on the file without carrying it in your head.',icon:Eye},
  {state:'follow_up',label:'Follow-Ups',help:'Things you need to circle back to later.',icon:RotateCcw},
];
const errorText=(e:unknown)=>e instanceof Error?e.message:'Something went wrong. Please try again.';

export default function WorkToolbox(){
  const [session,setSession]=useState<Session|null>(null),[ready,setReady]=useState(false);
  const [items,setItems]=useState<Item[]>([]),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
  const [reply,setReply]=useState(''),[error,setError]=useState('');
  const [draft,setDraft]=useState(''),[review,setReview]=useState(''),[recording,setRecording]=useState(false),[starting,setStarting]=useState(false),[seconds,setSeconds]=useState(0);
  const [liveTranscript,setLiveTranscript]=useState(''),[interim,setInterim]=useState(''),[pendingAudio,setPendingAudio]=useState<Blob|null>(null);
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[authBusy,setAuthBusy]=useState(false);
  const clientRef=useRef<SupabaseClient|null>(null),sessionRef=useRef<Session|null>(null),recognition=useRef<SpeechRecognitionLike|null>(null),recorder=useRef<MediaRecorder|null>(null);
  const recTimer=useRef<ReturnType<typeof setInterval>|null>(null),liveRef=useRef(''),interimRef=useRef(''),lastTurn=useRef<string|undefined>(undefined);

  const refresh=useCallback(async()=>{
    const client=clientRef.current,owner=sessionRef.current?.user.id;
    if(!client||!owner||!navigator.onLine)return;
    setLoading(true);
    try{
      const {data,error}=await client.from('items').select('*').eq('user_id',owner).eq('area','Work').neq('type','capture').is('parent_id',null).order('updated_at',{ascending:false}).limit(500);
      if(error)throw error;setItems(data as Item[]);
    }catch(e){setError(errorText(e));}finally{setLoading(false);}
  },[]);

  useEffect(()=>{
    let unsubscribe:(()=>void)|undefined;let dead=false;
    getSupabase().then(async client=>{
      if(dead)return;clientRef.current=client;
      const accept=async(next:Session|null)=>{
        if(next){
          const {data:allowed,error}=await client.rpc('toolbox_can_access');
          if(error||allowed!==true)next=null;
        }
        sessionRef.current=next;setSession(next);setReady(true);
        if(next)void refresh();else setItems([]);
      };
      const {data}=await client.auth.getSession();await accept(data.session);
      const auth=client.auth.onAuthStateChange((_event,next)=>setTimeout(()=>void accept(next),0));
      unsubscribe=()=>auth.data.subscription.unsubscribe();
    }).catch(e=>{setError(errorText(e));setReady(true);});
    return()=>{dead=true;unsubscribe?.();recognition.current?.abort();if(recorder.current?.state==='recording')recorder.current.stop();stopSpeaking();};
  },[refresh]);

  useEffect(()=>{const onFocus=()=>void refresh();window.addEventListener('focus',onFocus);return()=>window.removeEventListener('focus',onFocus);},[refresh]);

  async function signIn(e:React.FormEvent){
    e.preventDefault();setAuthBusy(true);setError('');
    try{
      const client=clientRef.current??await getSupabase();clientRef.current=client;
      const result=await client.auth.signInWithPassword({email,password});if(result.error)throw result.error;
      const {data:allowed,error}=await client.rpc('toolbox_can_access');
      if(error||allowed!==true){await client.auth.signOut({scope:'local'});throw new Error('This toolbox is private. Only its owner can sign in.');}
      setPassword('');
    }catch(e){setError(errorText(e));}finally{setAuthBusy(false);}
  }

  async function sendCapture(text?:string,audio?:Blob){
    const client=clientRef.current,owner=sessionRef.current?.user.id;if(!client||!owner)return;
    const normalized=text?normalizeWorkCaseNumbers(text.trim()):'';
    if(!normalized&&!audio)return;
    setBusy(true);setError('');
    try{
      const {data}=await client.auth.getSession();if(!data.session)throw new Error('Please sign in again.');
      const form=new FormData();form.set('id',crypto.randomUUID());form.set('captured_at',new Date().toISOString());form.set('time_zone',Intl.DateTimeFormat().resolvedOptions().timeZone);form.set('workspace','work');
      if(normalized)form.set('text',normalized);if(audio)form.set('audio',audio,'work-recording');if(lastTurn.current)form.set('reply_to',lastTurn.current);
      const response=await fetch(captureUrl,{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token,apikey:publicConfig.key},body:form,signal:AbortSignal.timeout(190000)});
      const result=await response.json() as TurnReceipt&{error?:string};if(!response.ok)throw new Error(result.error||'Could not organize that Work update.');
      lastTurn.current=result.turn_id;setReply(result.reply);speakReply(result.reply);setDraft('');setReview('');setLiveTranscript('');setInterim('');setPendingAudio(null);await refresh();
    }catch(e){setError(errorText(e));if(audio)setPendingAudio(audio);}finally{setBusy(false);}
  }

  async function microphone(){
    if(recording){if(recognition.current)recognition.current.stop();else recorder.current?.stop();return;}
    if(!sessionRef.current){setError('Sign in before using Work voice capture.');return;}
    stopSpeaking();setStarting(true);setError('');
    const Recognition=(window as SpeechRecognitionWindow).SpeechRecognition??(window as SpeechRecognitionWindow).webkitSpeechRecognition;
    if(Recognition){
      liveRef.current=review.trim();interimRef.current='';setLiveTranscript(review.trim());setInterim('');setReview('');setSeconds(0);
      const live=new Recognition();recognition.current=live;live.continuous=true;live.interimResults=true;live.lang='en-US';
      live.onresult=event=>{
        let final='',temp='';for(let i=event.resultIndex;i<event.results.length;i++){const words=event.results[i][0]?.transcript??'';if(event.results[i].isFinal)final=appendSpeech(final,words);else temp=appendSpeech(temp,words);}
        if(final){liveRef.current=appendSpeech(liveRef.current,final);setLiveTranscript(normalizeWorkCaseNumbers(liveRef.current));}
        interimRef.current=temp;setInterim(temp);
      };
      live.onerror=()=>setError('I lost the live transcript. Tap again or type the update.');
      live.onend=()=>{recognition.current=null;if(recTimer.current)clearInterval(recTimer.current);setRecording(false);const complete=normalizeWorkCaseNumbers(appendSpeech(liveRef.current,interimRef.current));setReview(complete);setLiveTranscript(complete);setInterim('');if(!complete)setError('I didn’t catch any words. Try again.');};
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
      rec.onstop=()=>{if(recTimer.current)clearInterval(recTimer.current);stream?.getTracks().forEach(track=>track.stop());setRecording(false);const audio=new Blob(chunks,{type:rec.mimeType||mime||'audio/mp4'});if(audio.size)void sendCapture(undefined,audio);else setError('No audio was recorded.');};
      rec.start(1000);setRecording(true);let elapsed=0;recTimer.current=setInterval(()=>{elapsed++;setSeconds(elapsed);if(elapsed>=300&&rec.state==='recording')rec.stop();},1000);
    }catch(e){stream?.getTracks().forEach(track=>track.stop());setError(e instanceof DOMException&&e.name==='NotAllowedError'?'Microphone access is off. Allow it in Safari’s website settings.':errorText(e));}
    finally{setStarting(false);}
  }

  async function changeStatus(item:Item){
    const client=clientRef.current;if(!client)return;setBusy(true);setError('');
    try{const {error}=await client.rpc('toolbox_set_status',{item_uuid:item.id,new_status:item.status==='completed'?'active':'completed'});if(error)throw error;await refresh();}
    catch(e){setError(errorText(e));}finally{setBusy(false);}
  }

  if(!ready)return <main className="work-toolbox"><p className="work-loading">Opening Work…</p></main>;
  if(!session)return <main className="work-toolbox"><section className="work-login"><BriefcaseBusiness/><h1>Work</h1><p>Sign in to open your private Work command center.</p><form onSubmit={e=>void signIn(e)}><label>Email<Input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Password<Input type="password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<p className="work-error">{error}</p>}<Button type="submit" disabled={authBusy}>{authBusy?<LoaderCircle className="spinning"/>:'Sign in'}</Button></form></section></main>;

  const active=items.filter(item=>item.status==='active');const completed=items.filter(item=>item.status==='completed');
  return <main className="work-toolbox">
    <header className="work-header"><div><p className="work-eyebrow">Dylan’s Toolbox</p><h1>Work</h1><p>Tell it what happened. Let the board remember where the ball is.</p></div><span className="work-header-icon"><BriefcaseBusiness/></span></header>
    {error&&<div className="work-error" role="alert">{error}</div>}
    {reply&&<aside className="work-orbit"><strong>Orbit</strong><p>{reply}</p></aside>}
    <section className="work-capture">
      <div className="work-capture-heading"><div><h2>{recording?'I’m listening.':'Update Work'}</h2><p>Say the file number naturally. I’ll normalize clear G case numbers for you.</p></div></div>
      <Button className={'work-mic '+(recording?'recording':'')} onClick={()=>void microphone()} disabled={starting||busy&&!recording}>{starting?<LoaderCircle className="spinning"/>:recording?<Square fill="currentColor"/>:<Mic/>}</Button>
      <p className="work-mic-label">{recording?Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')+' · Tap when done':review?'Review before sending':'Tap to talk'}</p>
      {recording&&(liveTranscript||interim)&&<div className="work-live">{normalizeWorkCaseNumbers(liveTranscript)}{interim&&<span> {interim}</span>}</div>}
      {review&&<div className="work-review"><Textarea value={review} onChange={e=>setReview(normalizeWorkCaseNumbers(e.target.value))}/><div className="work-review-actions"><Button onClick={()=>void sendCapture(review)} disabled={busy||!review.trim()}><Send/>Send update</Button><Button variant="outline" onClick={()=>void microphone()} disabled={busy}><Mic/>Keep talking</Button></div></div>}
      {!recording&&!review&&<form className="work-type" onSubmit={e=>{e.preventDefault();void sendCapture(draft);}}><Textarea placeholder="Example: I texted Mike about G 26 0441 and I’m waiting on the LLC docs." value={draft} onChange={e=>setDraft(e.target.value)} maxLength={30000}/><Button type="submit" disabled={busy||!draft.trim()}>{busy?<LoaderCircle className="spinning"/>:<><PenLine/>Send typed update</>}</Button></form>}
      {pendingAudio&&<Button variant="outline" disabled={busy} onClick={()=>void sendCapture(undefined,pendingAudio)}>Retry saved recording</Button>}
    </section>
    <section className="work-board">
      {groups.map(group=>{const rows=active.filter(item=>workState(item.content)===group.state);const Icon=group.icon;return <section className="work-group" key={group.state}><div className="work-group-heading"><span><Icon/></span><div><h2>{group.label}</h2><p>{group.help}</p></div><b>{rows.length}</b></div>{rows.length?<div className="work-list">{rows.map(item=><article className="work-item" key={item.id}><div className="work-item-main"><h3>{item.title}</h3>{workContent(item.content)&&<p>{workContent(item.content)}</p>}<div className="work-meta">{(item.due_at||item.due_date)&&<span>{dueLabel(item.due_at,item.due_date)}</span>}<span>{item.type}</span></div></div><Button size="icon" variant="ghost" aria-label={'Mark '+item.title+' complete'} onClick={()=>void changeStatus(item)} disabled={busy}><CheckCircle2/></Button></article>)}</div>:<p className="work-empty">Nothing here right now.</p>}</section>;})}
      <section className="work-group completed"><div className="work-group-heading"><span><CheckCircle2/></span><div><h2>Done</h2><p>Finished Work items.</p></div><b>{completed.length}</b></div>{completed.slice(0,20).map(item=><article className="work-item" key={item.id}><div className="work-item-main"><h3>{item.title}</h3>{workContent(item.content)&&<p>{workContent(item.content)}</p>}</div><Button size="icon" variant="ghost" aria-label={'Reopen '+item.title} onClick={()=>void changeStatus(item)} disabled={busy}><RotateCcw/></Button></article>)}</section>
      {loading&&<p className="work-loading"><LoaderCircle className="spinning"/> Refreshing Work…</p>}
    </section>
  </main>;
}
