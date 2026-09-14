'use client';

import {useCallback,useEffect,useState} from 'react';

type WorkPage='section'|'attention'|null;

export default function WorkSectionPageBridge(){
  const [openPage,setOpenPage]=useState<WorkPage>(null);

  const closePage=useCallback(()=>{
    const main=document.querySelector('main.work-toolbox');
    main?.classList.remove('work-section-page-open','work-attention-page-open');
    const heading=document.querySelector('main.work-toolbox .work-attention-heading');
    if(heading instanceof HTMLElement)heading.setAttribute('aria-expanded','false');
    setOpenPage(null);
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

    const handlePopState=()=>closePage();
    syncAttentionHeading();
    const observer=new MutationObserver(syncAttentionHeading);
    observer.observe(document.body,{childList:true,subtree:true});
    document.addEventListener('click',handleClick);
    document.addEventListener('keydown',handleKeyDown);
    window.addEventListener('popstate',handlePopState);
    return()=>{
      observer.disconnect();
      document.removeEventListener('click',handleClick);
      document.removeEventListener('keydown',handleKeyDown);
      window.removeEventListener('popstate',handlePopState);
      document.querySelector('main.work-toolbox')?.classList.remove('work-section-page-open','work-attention-page-open');
    };
  },[closePage]);

  if(!openPage)return null;

  const goHome=()=>{
    if(history.state?.toolboxWorkSectionPage||history.state?.toolboxWorkAttentionPage)history.back();
    else closePage();
  };

  return <div className="work-section-page-bar" role="navigation" aria-label="Work page navigation"><button type="button" onClick={goHome} aria-label="Back to Work home">← <span>Work Home</span></button></div>;
}
