'use client';

import {useCallback,useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {Archive,Lightbulb,LoaderCircle,PenLine,Plus,StickyNote,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {getSupabase} from '@/lib/supabase';
import './work-notes.css';

type KnowledgeKind='note'|'reference';
type WorkKnowledgeItem={
  id:string;
  type:KnowledgeKind;
  title:string;
  content:string;
  created_at:string;
  updated_at:string;
};
type EditorState={id:string|null;kind:KnowledgeKind};

const kindLabel=(kind:KnowledgeKind)=>kind==='reference'?'Learned':'Note';
const errorText=(error:unknown)=>error instanceof Error?error.message:'Could not update Work notes.';

export default function WorkNotesBridge(){
  const [target,setTarget]=useState<HTMLElement|null>(null);
  const [open,setOpen]=useState(false);
  const [items,setItems]=useState<WorkKnowledgeItem[]>([]);
  const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[message,setMessage]=useState('');
  const [editor,setEditor]=useState<EditorState|null>(null);
  const [title,setTitle]=useState(''),[content,setContent]=useState('');

  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const client=await getSupabase();
      const {data:{session}}=await client.auth.getSession();
      if(!session){setItems([]);return;}
      const {data,error}=await client.from('items')
        .select('id,type,title,content,created_at,updated_at')
        .eq('user_id',session.user.id)
        .eq('area','Work')
        .eq('status','active')
        .in('type',['note','reference'])
        .is('parent_id',null)
        .order('updated_at',{ascending:false})
        .limit(300);
      if(error)throw error;
      setItems((data??[]) as WorkKnowledgeItem[]);
    }catch(error){setError(errorText(error));}
    finally{setLoading(false);}
  },[]);

  useEffect(()=>{
    const syncTarget=()=>{
      const next=document.querySelector('main.work-toolbox .work-bottom-tabs');
      setTarget(next instanceof HTMLElement?next:null);
      if(!next){setOpen(false);setEditor(null);}
    };
    syncTarget();
    const observer=new MutationObserver(syncTarget);
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>observer.disconnect();
  },[]);

  useEffect(()=>{if(target)void load();},[target,load]);

  function startNew(kind:KnowledgeKind){
    setEditor({id:null,kind});setTitle('');setContent('');setError('');setMessage('');
  }

  function startEdit(item:WorkKnowledgeItem){
    setEditor({id:item.id,kind:item.type});setTitle(item.title);setContent(item.content);setError('');setMessage('');
  }

  function closeEditor(){setEditor(null);setTitle('');setContent('');setError('');}

  async function save(event:React.FormEvent){
    event.preventDefault();
    if(!editor||(!title.trim()&&!content.trim()))return;
    setBusy(true);setError('');setMessage('');
    try{
      const client=await getSupabase();
      const {data:{session}}=await client.auth.getSession();
      if(!session)throw new Error('Sign in again to save this Work note.');
      const fallback=content.trim().split(/\n+/)[0]?.trim()||kindLabel(editor.kind);
      const nextTitle=(title.trim()||fallback).slice(0,180);
      const nextContent=content.trim().slice(0,12000);
      const now=new Date().toISOString();
      if(editor.id){
        const {error}=await client.from('items').update({type:editor.kind,title:nextTitle,content:nextContent,updated_at:now})
          .eq('id',editor.id).eq('user_id',session.user.id).eq('area','Work').in('type',['note','reference']);
        if(error)throw error;
      }else{
        const {error}=await client.from('items').insert({user_id:session.user.id,type:editor.kind,title:nextTitle,content:nextContent,area:'Work',status:'active',importance:1,urgency:1,source_text:'',workflow_state:'active'});
        if(error)throw error;
      }
      await load();
      setEditor(null);setTitle('');setContent('');setMessage(editor.kind==='reference'?'Saved under Things Learned.':'Work note saved.');
    }catch(error){setError(errorText(error));}
    finally{setBusy(false);}
  }

  async function archiveCurrent(){
    if(!editor?.id||!window.confirm('Archive this Work note? It will disappear from this page but stay in your data.'))return;
    setBusy(true);setError('');setMessage('');
    try{
      const client=await getSupabase();
      const {data:{session}}=await client.auth.getSession();
      if(!session)throw new Error('Sign in again to archive this Work note.');
      const {error}=await client.from('items').update({status:'completed',completed_at:new Date().toISOString(),updated_at:new Date().toISOString()})
        .eq('id',editor.id).eq('user_id',session.user.id).eq('area','Work').in('type',['note','reference']);
      if(error)throw error;
      await load();closeEditor();setMessage('Archived.');
    }catch(error){setError(errorText(error));}
    finally{setBusy(false);}
  }

  const notes=items.filter(item=>item.type==='note');
  const learned=items.filter(item=>item.type==='reference');
  const launch=target?createPortal(
    <button type="button" className="work-notes-launch-card" data-section="notes" aria-label={`Open Notes and Learned, ${items.length} saved`} onClick={event=>{event.preventDefault();event.stopPropagation();setOpen(true);setEditor(null);setMessage('');void load();}}>
      <span className="work-tab-icon"><StickyNote/><b>{items.length}</b></span><span>Notes &amp; Learned</span>
    </button>,target):null;

  return <>
    {launch}
    {open&&<div className="work-notes-overlay" role="dialog" aria-modal="true" aria-label="Work Notes and Things Learned">
      <section className="work-notes-page">
        <header className="work-notes-header">
          <div><p>Dylan’s Toolbox · Work</p><h1>Notes &amp; Things Learned</h1><span>Keep useful details here when they do not belong to a specific case.</span></div>
          <Button size="icon" variant="ghost" aria-label="Close Work notes" onClick={()=>{setOpen(false);closeEditor();}}><X/></Button>
        </header>

        {error&&<div className="work-notes-message error" role="alert">{error}</div>}
        {message&&!error&&<div className="work-notes-message">{message}</div>}

        {editor?<form className="work-notes-editor" onSubmit={save}>
          <div className="work-notes-editor-heading">
            <span className={editor.kind==='reference'?'learned':'note'}>{editor.kind==='reference'?<Lightbulb/>:<StickyNote/>}{editor.id?'Edit ':'New '}{kindLabel(editor.kind)}</span>
            <Button type="button" variant="ghost" onClick={closeEditor} disabled={busy}>Back</Button>
          </div>
          <label><span>Title <small>optional</small></span><Input autoFocus value={title} onChange={event=>setTitle(event.target.value)} maxLength={180} placeholder={editor.kind==='reference'?'Example: Payoff request process':'Example: Call notes / office reminder'}/></label>
          <label><span>Details</span><Textarea value={content} onChange={event=>setContent(event.target.value)} maxLength={12000} placeholder={editor.kind==='reference'?'What did you learn, and what do you want to remember about it?':'Write whatever you need to keep here.'}/></label>
          <div className="work-notes-editor-actions">
            {editor.id&&<Button type="button" variant="outline" className="archive" onClick={()=>void archiveCurrent()} disabled={busy}><Archive/>Archive</Button>}
            <Button type="submit" disabled={busy||(!title.trim()&&!content.trim())}>{busy?<LoaderCircle className="spinning"/>:<><PenLine/>Save</>}</Button>
          </div>
        </form>:<>
          <div className="work-notes-actions">
            <Button type="button" onClick={()=>startNew('note')}><Plus/><StickyNote/>Add Note</Button>
            <Button type="button" variant="outline" onClick={()=>startNew('reference')}><Plus/><Lightbulb/>Add Something Learned</Button>
          </div>

          {loading?<p className="work-notes-loading"><LoaderCircle className="spinning"/>Loading your Work notes…</p>:<div className="work-notes-groups">
            <KnowledgeGroup title="Notes" kind="note" items={notes} empty="No Work notes yet." onEdit={startEdit}/>
            <KnowledgeGroup title="Things Learned" kind="reference" items={learned} empty="Nothing saved here yet. Add a process, rule, or detail you want to remember." onEdit={startEdit}/>
          </div>}
        </>}
      </section>
    </div>}
  </>;
}

function KnowledgeGroup({title,kind,items,empty,onEdit}:{title:string;kind:KnowledgeKind;items:WorkKnowledgeItem[];empty:string;onEdit:(item:WorkKnowledgeItem)=>void}){
  const Icon=kind==='reference'?Lightbulb:StickyNote;
  return <section className={'work-notes-group '+(kind==='reference'?'learned':'note')}>
    <div className="work-notes-group-heading"><span><Icon/></span><div><h2>{title}</h2><p>{items.length} saved</p></div></div>
    {items.length?<div className="work-notes-list">{items.map(item=><button type="button" className="work-note-card" key={item.id} onClick={()=>onEdit(item)}><div><strong>{item.title}</strong>{item.content&&<p>{item.content}</p>}<small>Updated {new Date(item.updated_at).toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'})}</small></div><PenLine/></button>)}</div>:<div className="work-notes-empty"><Icon/><p>{empty}</p></div>}
  </section>;
}
