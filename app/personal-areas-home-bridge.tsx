'use client';

import {useEffect} from 'react';
import './personal-areas-home.css';

export default function PersonalAreasHomeBridge(){
  useEffect(()=>{
    const initialized=new WeakSet<Element>();

    const sync=()=>{
      const roots=Array.from(document.querySelectorAll('main.shell'));
      for(const root of roots){
        const tabs=Array.from(root.querySelectorAll('.bottom-nav [role="tab"]'));
        if(!tabs.length)continue;

        const areasTab=tabs.find(tab=>(tab.textContent||'').trim()==='Areas');
        const todayTab=tabs.find(tab=>(tab.textContent||'').trim()==='Today');
        if(!(areasTab instanceof HTMLElement))continue;

        root.classList.add('personal-areas-first');
        areasTab.classList.add('personal-home-tab');
        if(todayTab instanceof HTMLElement)todayTab.classList.add('personal-attention-tab');

        if(!initialized.has(root)){
          initialized.add(root);
          if(areasTab.getAttribute('data-state')!=='active')requestAnimationFrame(()=>areasTab.click());
        }
      }
    };

    sync();
    const observer=new MutationObserver(sync);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-state']});
    return()=>{
      observer.disconnect();
      document.querySelectorAll('main.shell.personal-areas-first').forEach(root=>root.classList.remove('personal-areas-first'));
      document.querySelectorAll('.personal-home-tab').forEach(tab=>tab.classList.remove('personal-home-tab'));
      document.querySelectorAll('.personal-attention-tab').forEach(tab=>tab.classList.remove('personal-attention-tab'));
    };
  },[]);

  return null;
}
