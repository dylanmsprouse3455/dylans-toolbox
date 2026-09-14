'use client';

import {useCallback,useEffect,useState} from 'react';

export default function WorkSectionPageBridge(){
  const [open,setOpen]=useState(false);

  const closePage=useCallback(()=>{
    document.querySelector('main.work-toolbox')?.classList.remove('work-section-page-open');
    setOpen(false);
  },[]);

  useEffect(()=>{
    const handleClick=(event:MouseEvent)=>{
      const target=event.target;
      if(!(target instanceof Element))return;
      const card=target.closest('main.work-toolbox .work-bottom-tabs button');
      if(!card)return;
      requestAnimationFrame(()=>{
        const main=document.querySelector('main.work-toolbox');
        if(!main)return;
        main.classList.add('work-section-page-open');
        setOpen(true);
        window.scrollTo({top:0,left:0,behavior:'auto'});
        if(!history.state?.toolboxWorkSectionPage){
          history.pushState({...history.state,toolboxWorkSectionPage:true},'');
        }
      });
    };
    const handlePopState=()=>closePage();
    document.addEventListener('click',handleClick);
    window.addEventListener('popstate',handlePopState);
    return()=>{
      document.removeEventListener('click',handleClick);
      window.removeEventListener('popstate',handlePopState);
      document.querySelector('main.work-toolbox')?.classList.remove('work-section-page-open');
    };
  },[closePage]);

  if(!open)return null;

  const goHome=()=>{
    if(history.state?.toolboxWorkSectionPage)history.back();
    else closePage();
  };

  return <div className="work-section-page-bar" role="navigation" aria-label="Work section navigation"><button type="button" onClick={goHome} aria-label="Back to Work home">← <span>Work Home</span></button></div>;
}
