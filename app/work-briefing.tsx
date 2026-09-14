'use client';

import {AlertTriangle,CheckCircle2,ChevronRight,Clock3,Eye,Sparkles,X} from 'lucide-react';
import type {WorkCase} from '@/lib/work-types';
import {buildWorkBriefing,nextTimeSensitiveMoment} from '@/lib/work-briefing';
import {Button} from '@/components/ui/button';
import './work-briefing.css';

type Props={cases:WorkCase[];error?:string|null;onClose:()=>void;onOpenCase:(item:WorkCase)=>void};

function stripCasePrefix(item:WorkCase){
  return item.title.replace(/^G\d{2}-\d{4}\s*[·—-]?\s*/,'').trim()||item.title;
}

function shortDate(value:string){
  const date=new Date(value);
  return date.toLocaleDateString([],{month:'short',day:'numeric'});
}

function timingLabel(item:WorkCase,now:number){
  const next=nextTimeSensitiveMoment(item);
  if(Number.isFinite(next)){
    const text=shortDate(new Date(next).toISOString());
    if(next<=now)return 'Due now';
    if(item.follow_up_at||item.follow_up_date)return 'Due '+text;
    if(item.closing_date)return 'Closes '+text;
  }
  if(item.ball_owner==='other')return 'Waiting on '+(item.ball_with||'someone else');
  if(item.ball_owner==='me')return 'Your move';
  if(item.workflow_state==='follow_up')return 'Follow-up';
  return 'Watching';
}

const groupIcon={
  needs_you:AlertTriangle,
  due_soon:Clock3,
  waiting:Clock3,
  watching:Eye,
  recently_completed:CheckCircle2,
} as const;

export default function WorkBriefing({cases,error,onClose,onOpenCase}:Props){
  const now=Date.now();
  const briefing=buildWorkBriefing(cases,now);
  const summary=[
    briefing.needsYou?briefing.needsYou+' need'+(briefing.needsYou===1?'s':'')+' you':'',
    briefing.dueSoon?briefing.dueSoon+' due soon':'',
    briefing.waiting?briefing.waiting+' waiting':'',
    briefing.watching?briefing.watching+' watching':'',
  ].filter(Boolean).join(' · ');

  return <div className="work-briefing-overlay" role="dialog" aria-modal="true" aria-label="Work briefing">
    <section className="work-briefing-shell">
      <header className="work-briefing-top">
        <div><p className="work-step">Current Work</p><h2>Work Briefing</h2><p>{error?'Could not load the current files.':summary||'Nothing active needs tracking right now.'}</p></div>
        <Button size="icon" variant="ghost" aria-label="Close briefing" onClick={onClose}><X/></Button>
      </header>

      <div className="work-briefing-source"><Sparkles/><span>Built from each file’s current state, not old timeline entries.</span></div>

      {error?<div className="work-briefing-error"><AlertTriangle/><div><strong>Briefing unavailable</strong><p>{error}</p></div></div>:briefing.groups.length?briefing.groups.map(group=>{
        const Icon=groupIcon[group.key];
        return <section className={'work-briefing-group group-'+group.key} key={group.key}>
          <div className="work-briefing-group-title"><span><Icon/></span><div><h3>{group.label}</h3><p>{group.items.length} {group.items.length===1?'file':'files'}</p></div></div>
          <div className="work-briefing-cards">
            {group.items.map(item=><button type="button" className="work-briefing-card" key={item.id} onClick={()=>onOpenCase(item)}>
              <div className="work-briefing-card-top"><div><strong>{item.case_number||'Work item'}</strong><span>{stripCasePrefix(item)}</span></div><ChevronRight/></div>
              <div className="work-briefing-status">{timingLabel(item,now)}</div>
              {item.current_situation&&<p className="work-briefing-situation">{item.current_situation}</p>}
              {item.status==='active'&&item.next_action&&<div className="work-briefing-next"><span>Next</span><p>{item.next_action}</p></div>}
              <div className="work-briefing-open">Open file</div>
            </button>)}
          </div>
        </section>;
      }):<div className="work-briefing-empty"><CheckCircle2/><h3>You’re clear.</h3><p>No active Work files need attention, waiting, or watching.</p></div>}
    </section>
  </div>;
}
