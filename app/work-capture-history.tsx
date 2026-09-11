'use client';
import {useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {pendingWorkText,type PendingWorkText} from '@/lib/work-local';
import type {OrganizedCapture} from '@/lib/work-organized';
type Row={capture_id:string;version_id:string;version:number;receipt_id:string;raw_transcript:string;raw_origin:string;organized:OrganizedCapture|null;correction:string|null;truth_status:string;captured_at:string;state:string;error_stage:string|null;receipt_status:string;turn_result:{kind?:string}|null};
export default function WorkCaptureHistory({client,owner,busy,onClose,onRetry,onLocalRetry,onCorrect}:{client:SupabaseClient;owner:string;busy:boolean;onClose:()=>void;onRetry:(id:string)=>Promise<void>;onLocalRetry:(capture:PendingWorkText)=>Promise<void>;onCorrect:(receipt:string,correction:string)=>Promise<void>}){
  const [rows,setRows]=useState<Row[]>([]),[local,setLocal]=useState<PendingWorkText[]>([]),[query,setQuery]=useState(''),[error,setError]=useState(''),[editing,setEditing]=useState<string|null>(null),[correction,setCorrection]=useState(''),[versions,setVersions]=useState<Row[]>([]);
  useEffect(()=>{let dead=false;const timer=setTimeout(()=>{void(async()=>{
    try{
      let request=client.from('work_capture_evidence').select('capture_id,version_id,version,receipt_id,raw_transcript,raw_origin,organized,correction,truth_status,captured_at,state,error_stage,receipt_status,turn_result').eq('user_id',owner).eq('truth_status','current');
      if(query.trim())request=request.textSearch('search_document',query.trim(),{config:'simple',type:'websearch'});
      const result=await request.order('created_at',{ascending:false}).limit(30);if(result.error)throw result.error;
      if(!dead){setRows(result.data as Row[]);setLocal(await pendingWorkText(owner));}
    }catch(e){if(!dead)setError(e instanceof Error?e.message:'Could not load captures.');}
  })();},150);return()=>{dead=true;clearTimeout(timer);};},[client,owner,query]);
  async function history(id:string){const result=await client.from('work_capture_evidence').select('*').eq('capture_id',id).order('version',{ascending:false});if(result.error){setError('Could not load version history.');return;}setVersions(result.data as Row[]);}
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="work-capture-history"><DialogHeader><DialogTitle>Recent Captures</DialogTitle><DialogDescription>Original words and organized interpretations. Case changes still need confirmation.</DialogDescription></DialogHeader>
    <Input aria-label="Search captures" placeholder="Search captures…" value={query} onChange={e=>setQuery(e.target.value)}/>
    {error&&<p role="alert">{error}</p>}
    {local.filter(item=>!rows.some(row=>row.capture_id===item.id)).map(item=><article key={item.id}><p style={{whiteSpace:'pre-wrap'}}>{item.text}</p><Button disabled={busy} onClick={()=>void onLocalRetry(item)}>Retry saved text</Button></article>)}
    {rows.map(row=><article key={row.version_id}><time>{new Date(row.captured_at).toLocaleString()}</time><p>{row.organized?.summary||'Text saved. Organization can be retried.'}</p>
      <details><summary>Original transcript</summary>{row.raw_origin==='legacy_snapshot'&&<small>Preserved from the earlier system; it may include earlier normalization or corrections.</small>}<p style={{whiteSpace:'pre-wrap'}}>{row.raw_transcript}</p></details>
      {row.organized&&<details><summary>Organized details · version {row.version}</summary>{row.organized.entries.map((entry,i)=><p key={i}><strong>{entry.kind.replaceAll('_',' ')} · {entry.truth_status}</strong><br/>{entry.text}{entry.date_wording&&<><br/><small>{entry.date_wording}{entry.resolved_date||entry.resolved_at?' → '+(entry.resolved_date||entry.resolved_at):' · date uncertain'}</small></>}</p>)}</details>}
      <div className="work-history-actions">{(row.receipt_status==='pending'||!row.organized)&&<Button variant="outline" disabled={busy} onClick={()=>void onRetry(row.capture_id)}>{row.turn_result?.kind==='work_preview'?'Review case changes':'Retry organization'}</Button>}<Button variant="ghost" disabled={busy} onClick={()=>{setEditing(row.receipt_id);setCorrection('');}}>Correct interpretation</Button>{row.version>1&&<Button variant="ghost" onClick={()=>void history(row.capture_id)}>Earlier versions</Button>}</div>
      {editing===row.receipt_id&&<form onSubmit={e=>{e.preventDefault();void onCorrect(row.receipt_id,correction);}}><Textarea aria-label="Correction" value={correction} onChange={e=>setCorrection(e.target.value)} maxLength={5000} placeholder="What should Orbit understand differently?"/><Button disabled={busy||!correction.trim()}>Save correction and review</Button></form>}
      {versions.filter(v=>v.capture_id===row.capture_id&&v.version!==row.version).map(v=><details key={v.version_id}><summary>Version {v.version} · superseded interpretation</summary>{v.correction&&<p>Correction: {v.correction}</p>}<p>{v.organized?.summary||'No completed organization.'}</p></details>)}
    </article>)}
    {!rows.length&&!local.length&&<p>No matching captures.</p>}
  </DialogContent></Dialog>;
}
