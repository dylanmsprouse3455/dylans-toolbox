'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {getSupabase} from '@/lib/supabase';
import type {WorkCase} from '@/lib/work-types';
import WorkBriefing from './work-briefing';

type WorkPage='section'|'attention'|null;

export default function WorkSectionPageBridge(){
  const [openPage,setOpenPage]=useState<WorkPage>(null);
  const [briefingOpen,setBriefingOpen]=useState(false);
  const [briefingCases,setBriefingCases]=useState<WorkCase[]>([]);
  const [briefingError,setBriefingError]=useState<string|null>(null);
  const briefingOpenRef=useRef(false);

  const closePage=useCallback(()=>{
    const main=document.querySelector('main.work-toolbox');
    main?.classList.remove('work-section-page-open','work-attention-page-open');
    const heading=document.querySelector('main.work-toolbox .work-attention-heading');
    if(heading instanceof HTMLElement)heading.setAttribute('aria-expanded','false');
    setOpenPage(null);
  },[]);

  const closeBriefing=useCallback(()=>{
    briefingOpenRef.current=false;
    setBriefingOpen(false);
    if(history.state?.toolboxWorkBriefingPage)history.back();
  },[]);

  const openBriefing=useCallback(async()=>{
    setBriefingError(null);
    try{
      const client=await getSupabase();
      const {data:{session}}=await client.auth.getSession();
      if(!session)throw new Error('Sign in again to load your Work briefing.');
      const {data,error}=await client.from('work_cases').select('*').eq('user_id',session.user.id).order('last_event_at',{ascending:false}).limit(500);
      if(error)throw error;
      setBriefingCases((data??[]) as WorkCase[]);
    }catch(error){
      setBriefingCases([]);
      setBriefingError(error instanceof Error?error.message:'Could not load the current Work files.');
    }
    briefingOpenRef.current=true;
    setBriefingOpen(true);
    if(!history.state?.toolboxWorkBriefingPage)history.pushState({...history.state,toolboxWorkBriefingPage:true},'');
  },[]);

  const openCaseFromBriefing=useCallback((item:WorkCase)=>{
    briefingOpenRef.current=false;
    setBriefingOpen(false);
    if(history.state?.toolboxWorkBriefingPage){
      const state={...(history.state??{})};delete state.toolboxWorkBriefingPage;history.replaceState(state,'');
    }
    const section=item.status==='completed'?'done':item.workflow_state;
    const tab=document.querySelector(`main.work-toolbox .work-bottom-tabs button[data-section="${section}"]`);
    if(tab instanceof HTMLButtonElement)tab.click();
    const key=(item.case_number||item.title).toLowerCase();
    const tryOpen=(attempt:number)=>{
      const buttons=Array.from(document.querySelectorAll('main.work-toolbox .work-list .work-item'));
      const match=buttons.find(button=>(button.textContent||'').toLowerCase().includes(key));
      if(match instanceof HTMLButtonElement){match.click();return;}
      if(attempt<8)window.setTimeout(()=>tryOpen(attempt+1),60);
    };
    window.setTimeout(()=>tryOpen(0),40);
  },[]);

  useEffect(()=>{
    const mainFor=()=>document.querySelector('main.work-toolbox');
    const attentionHeading=()=>document.querySelector('main.work-toolbox .work-attention-heading');

    const syncAttentionHeading=()=>{
      const heading=attentionHeading();
      if(!(heading instanceof HTMLElement))return;
      heading.setAttribute('role','button');
      heading.tabIndex=0;
      heading.setAttribute('aria-label','Open Needs attention');
      heading.setAttribute('aria-expanded',mainFor()?.classList.contains('work-attention-page-open')?'true':'false');
    };

    const pushState=(key:'toolboxWorkSectionPage'|'toolboxWorkAttentionPage')=>{
      if(!history.state?.[key])history.pushState({...history.state,[key]:true},'');
    };

    const openSection=()=>{
      const main=mainFor();
      if(!main)return;
      main.classList.remove('work-attention-page-open');
      main.classList.add('work-section-page-open');
      setOpenPage('section');
      window.scrollTo({top:0,left:0,behavior:'auto'});
      pushState('toolboxWorkSectionPage');
    };

    const openAttention=()=>{
      const main=mainFor();
      const heading=attentionHeading();
      if(!main||main.classList.contains('work-attention-page-open'))return;
      main.classList.remove('work-section-page-open');
      main.classList.add('work-attention-page-open');
      if(heading instanceof HTMLElement)heading.setAttribute('aria-expanded','true');
      setOpenPage('attention');
      window.scrollTo({top:0,left:0,behavior:'auto'});
      pushState('toolboxWorkAttentionPage');
    };

    const handleBriefClick=(event:MouseEvent)=>{
      const target=event.target;
      if(!(target instanceof Element))return;
      const button=target.closest('main.work-toolbox .work-header-actions button');
      if(!(button instanceof HTMLButtonElement)||!button.textContent?.includes('Brief me'))return;
      event.preventDefault();
      event.stopPropagation();
      void openBriefing();
    };

    const handleClick=(event:MouseEvent)=>{
      const target=event.target;
      if(!(target instanceof Element))return;
      const attention=target.closest('main.work-toolbox .work-attention-heading');
      if(attention){
        event.preventDefault();
        openAttention();
        return;
      }
      const card=target.closest('main.work-toolbox .work-bottom-tabs button');
      if(!card)return;
      requestAnimationFrame(openSection);
    };

    const handleKeyDown=(event:KeyboardEvent)=>{
      if(event.key!=='Enter'&&event.key!==' ')return;
      const target=event.target;
      if(!(target instanceof Element)||!target.closest('main.work-toolbox .work-attention-heading'))return;
      event.preventDefault();
      openAttention();
    };

    const handlePopState=()=>{
      if(briefingOpenRef.current){briefingOpenRef.current=false;setBriefingOpen(false);return;}
      closePage();
    };
    syncAttentionHeading();
    const observer=new MutationObserver(syncAttentionHeading);
    observer.observe(document.body,{childList:true,subtree:true});
    document.addEventListener('click',handleBriefClick,true);
    document.addEventListener('click',handleClick);
    document.addEventListener('keydown',handleKeyDown);
    window.addEventListener('popstate',handlePopState);
    return()=>{
      observer.disconnect();
      document.removeEventListener('click',handleBriefClick,true);
      document.removeEventListener('click',handleClick);
      document.removeEventListener('keydown',handleKeyDown);
      window.removeEventListener('popstate',handlePopState);
      document.querySelector('main.work-toolbox')?.classList.remove('work-section-page-open','work-attention-page-open');
    };
  },[closePage,openBriefing]);

  const goHome=()=>{
    if(history.state?.toolboxWorkSectionPage||history.state?.toolboxWorkAttentionPage)history.back();
    else closePage();
  };

  return <>
    {openPage&&<div className="work-section-page-bar" role="navigation" aria-label="Work page navigation"><button type="button" onClick={goHome} aria-label="Back to Work home">← <span>Work Home</span></button></div>}
    {briefingOpen&&<WorkBriefing cases={briefingCases} error={briefingError} onClose={closeBriefing} onOpenCase={openCaseFromBriefing}/>}
  </>;
}
