'use client';

import {useState} from 'react';
import {ArrowLeft,AudioLines,Box,BriefcaseBusiness,ChevronRight,Folder,Share2,UserRound} from 'lucide-react';
import Toolbox from './toolbox';
import WorkToolbox from './work-toolbox';
import {getSupabase,setClientWorkspace} from '@/lib/supabase';
import './workspace-gate.css';

type Workspace='personal'|'work'|null;

export default function WorkspaceGate(){
  const [workspace,setWorkspace]=useState<Workspace>(null);
  const choose=(next:Workspace)=>{setClientWorkspace(next);setWorkspace(next);};
  const openAudio=async()=>{
    const supabase=await getSupabase();
    const {data,error}=await supabase.from('toolbox_private_config').select('audio_intelligence_url').single();
    const url=data?.audio_intelligence_url;
    if(error||!url){window.alert('Audio Intelligence is not configured for this account.');return;}
    try{
      const parsed=new URL(url);
      if(parsed.protocol!=='https:')throw new Error();
      window.location.assign(parsed.toString());
    }catch{window.alert('Audio Intelligence has an invalid private address.');}
  };

  const openProjectManager=async()=>{
    const supabase=await getSupabase();
    const {data,error}=await supabase.from('toolbox_private_config').select('project_manager_url').single();
    const url=(data as {project_manager_url?:string}|null)?.project_manager_url;
    if(error||!url){window.alert('Project Manager is built on Kali but its private browser address is not configured yet.');return;}
    try{
      const parsed=new URL(url);
      if(parsed.protocol!=='https:')throw new Error();
      window.location.assign(parsed.toString());
    }catch{window.alert('Project Manager has an invalid private address.');}
  };

  if(workspace==='personal')return <div className="workspace-active">
    <div className="workspace-switchbar"><button type="button" className="workspace-switch" onClick={()=>choose(null)}><ArrowLeft/>Work or Personal</button></div>
    <Toolbox/>
  </div>;

  if(workspace==='work')return <div className="workspace-active">
    <div className="workspace-switchbar"><button type="button" className="workspace-switch" onClick={()=>choose(null)}><ArrowLeft/>Work or Personal</button></div>
    <WorkToolbox/>
  </div>;

  return <main className="workspace-screen workspace-picker">
    <div className="workspace-frame">
      <header className="workspace-picker-header">
        <span className="workspace-brand-mark"><Box/></span>
        <div><p className="workspace-eyebrow">Dylan’s Toolbox</p><h1>Where are you headed?</h1></div>
      </header>
      <div className="workspace-cards" role="group" aria-label="Choose a toolbox space">
        <button type="button" className="workspace-card personal" onClick={()=>choose('personal')}>
          <span className="workspace-card-icon"><UserRound/></span>
          <span className="workspace-card-text"><strong>Personal</strong><small>Your current Toolbox, exactly where you left it.</small></span>
          <ChevronRight className="workspace-chevron"/>
        </button>
        <button type="button" className="workspace-card work" onClick={()=>choose('work')}>
          <span className="workspace-card-icon"><BriefcaseBusiness/></span>
          <span className="workspace-card-text"><strong>Work</strong><small>Track actions, responses, follow-ups, and files.</small></span>
          <ChevronRight className="workspace-chevron"/>
        </button>
        <button type="button" className="workspace-card social" onClick={()=>window.location.assign('https://social.dsdigitaldesigns.org/')}>
          <span className="workspace-card-icon"><Share2/></span>
          <span className="workspace-card-text"><strong>Social Control</strong><small>Open your protected social dashboard.</small></span>
          <ChevronRight className="workspace-chevron"/>
        </button>
        <button type="button" className="workspace-card manager" onClick={openProjectManager}>
          <span className="workspace-card-icon"><ClipboardCheck/></span>
          <span className="workspace-card-text"><strong>Project Manager</strong><small>Review projects, approve batches, contest ideas, and see what is complete.</small></span>
          <ChevronRight className="workspace-chevron"/>
        </button>
        <button type="button" className="workspace-card audio" onClick={openAudio}>
          <span className="workspace-card-icon"><AudioLines/></span>
          <span className="workspace-card-text"><strong>Audio Intelligence</strong><small>Search recordings, review transcripts, and process new audio on Kali.</small></span>
          <ChevronRight className="workspace-chevron"/>
        </button>
        <button type="button" className="workspace-card manager" onClick={()=>window.location.assign('https://social.dsdigitaldesigns.org/project-manager')}>
          <span className="workspace-card-icon"><Folder/></span>
          <span className="workspace-card-text"><strong>Project Manager</strong><small>See projects, batches, progress, reports, discoveries, and verification.</small></span>
          <ChevronRight className="workspace-chevron"/>
        </button>
      </div>
    </div>
  </main>;
}
