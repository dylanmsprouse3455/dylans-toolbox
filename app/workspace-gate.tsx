'use client';

import {useState} from 'react';
import {ArrowLeft,AudioLines,Box,BriefcaseBusiness,ChevronRight,Share2,UserRound} from 'lucide-react';
import Toolbox from './toolbox';
import WorkToolbox from './work-toolbox';
import {setClientWorkspace} from '@/lib/supabase';
import './workspace-gate.css';

type Workspace='personal'|'work'|null;

export default function WorkspaceGate(){
  const [workspace,setWorkspace]=useState<Workspace>(null);
  const choose=(next:Workspace)=>{setClientWorkspace(next);setWorkspace(next);};
  const openAudio=()=>{
    const key='toolbox:audio-intelligence-url';
    let url=window.localStorage.getItem(key);
    if(!url){
      url=window.prompt('Paste your private Audio Intelligence link:')?.trim()||'';
      if(!url)return;
      try{const parsed=new URL(url);if(parsed.protocol!=='https:')throw new Error();url=parsed.toString();}catch{window.alert('Use the private HTTPS Audio Intelligence link.');return;}
      window.localStorage.setItem(key,url);
    }
    window.location.assign(url);
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
        <button type="button" className="workspace-card audio" onClick={openAudio}>
          <span className="workspace-card-icon"><AudioLines/></span>
          <span className="workspace-card-text"><strong>Audio Intelligence</strong><small>Search recordings, review transcripts, and process new audio on Kali.</small></span>
          <ChevronRight className="workspace-chevron"/>
        </button>
      </div>
    </div>
  </main>;
}
