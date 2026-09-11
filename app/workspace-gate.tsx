'use client';

import {useState} from 'react';
import {ArrowLeft,Box,BriefcaseBusiness,ChevronRight,UserRound} from 'lucide-react';
import Toolbox from './toolbox';
import './workspace-gate.css';

type Workspace='personal'|'work'|null;

export default function WorkspaceGate(){
  const [workspace,setWorkspace]=useState<Workspace>(null);

  if(workspace==='personal')return <div className="workspace-active">
    <div className="workspace-switchbar"><button type="button" className="workspace-switch" onClick={()=>setWorkspace(null)}><ArrowLeft/>Work or Personal</button></div>
    <Toolbox/>
  </div>;

  if(workspace==='work')return <main className="workspace-screen">
    <div className="workspace-frame">
      <button type="button" className="workspace-back" onClick={()=>setWorkspace(null)}><ArrowLeft/>Work or Personal</button>
      <section className="workspace-work-shell">
        <div className="workspace-heading-icon work"><BriefcaseBusiness/></div>
        <p className="workspace-eyebrow">Dylan’s Toolbox</p>
        <h1>Work</h1>
        <p className="workspace-copy">Your work command center will live here without changing your Personal toolbox.</p>
        <div className="workspace-preview">
          <div><strong>To Do</strong><span>Things you need to handle.</span></div>
          <div><strong>Waiting on Response</strong><span>Texts, calls, emails, and requests you’re waiting on.</span></div>
          <div><strong>Watching</strong><span>Files that need your eye, but not an action yet.</span></div>
          <div><strong>Follow-Ups</strong><span>Things that need another touch later.</span></div>
        </div>
        <p className="workspace-note">The Work side is separated now. We can build its actual workflow next.</p>
      </section>
    </div>
  </main>;

  return <main className="workspace-screen workspace-picker">
    <div className="workspace-frame">
      <header className="workspace-picker-header">
        <span className="workspace-brand-mark"><Box/></span>
        <div><p className="workspace-eyebrow">Dylan’s Toolbox</p><h1>Where are you headed?</h1></div>
      </header>
      <div className="workspace-cards" role="group" aria-label="Choose a toolbox space">
        <button type="button" className="workspace-card personal" onClick={()=>setWorkspace('personal')}>
          <span className="workspace-card-icon"><UserRound/></span>
          <span className="workspace-card-text"><strong>Personal</strong><small>Your current Toolbox, exactly where you left it.</small></span>
          <ChevronRight className="workspace-chevron"/>
        </button>
        <button type="button" className="workspace-card work" onClick={()=>setWorkspace('work')}>
          <span className="workspace-card-icon"><BriefcaseBusiness/></span>
          <span className="workspace-card-text"><strong>Work</strong><small>Track actions, responses, follow-ups, and files.</small></span>
          <ChevronRight className="workspace-chevron"/>
        </button>
      </div>
    </div>
  </main>;
}
