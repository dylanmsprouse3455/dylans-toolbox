'use client';
import {useEffect,useMemo,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {DatabaseBackup,Download,LoaderCircle,RotateCcw} from 'lucide-react';
import {Button} from '@/components/ui/button';

type Backup={id:string;created_at:string;item_count:number;snapshot?:unknown};

export function PersonalRecovery({client,onRestored}:{client:SupabaseClient;onRestored?:()=>void}){
  const [backups,setBackups]=useState<Backup[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const latest=backups[0];
  const latestLabel=useMemo(()=>latest?new Date(latest.created_at).toLocaleString():'No backup yet',[latest]);
  async function load(){
    const {data,error}=await client.from('personal_backups').select('id,created_at,item_count').order('created_at',{ascending:false}).limit(10);
    if(error)throw error;setBackups((data??[]) as Backup[]);
  }
  useEffect(()=>{void load().catch(()=>setMessage('Backup status is temporarily unavailable.'));},[client]);
  async function createBackup(){
    setBusy(true);setMessage('');
    try{const {error}=await client.rpc('toolbox_create_personal_backup');if(error)throw error;await load();setMessage('Personal backup created.');}
    catch{setMessage('Could not create the backup. Try again when connected.');}
    finally{setBusy(false);}
  }
  async function downloadLatest(){
    if(!latest)return;
    setBusy(true);setMessage('');
    try{
      const {data,error}=await client.from('personal_backups').select('id,created_at,item_count,snapshot').eq('id',latest.id).single();
      if(error)throw error;
      const blob=new Blob([JSON.stringify({exported_at:new Date().toISOString(),backup:data},null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='dylans-toolbox-personal-backup-'+data.created_at.slice(0,10)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),0);
      setMessage('Backup downloaded.');
    }catch{setMessage('Could not download the backup.');}finally{setBusy(false);}
  }
  async function restoreLatest(){
    if(!latest||!confirm('Restore this Personal backup? Current Personal items are safety-backed-up first, and Work is not touched.'))return;
    setBusy(true);setMessage('');
    try{
      const {error}=await client.rpc('toolbox_restore_personal_backup',{backup_uuid:latest.id});if(error)throw error;
      setMessage('Personal backup restored.');onRestored?.();
    }catch{setMessage('Could not restore the backup. Nothing in Work was changed.');}finally{setBusy(false);}
  }
  return <section className="auth-card" style={{marginTop:0}} aria-label="Personal backup and recovery">
    <div style={{display:'flex',gap:10,alignItems:'center'}}><DatabaseBackup size={20}/><div><h3>Personal backup & recovery</h3><p className="muted" style={{marginTop:4}}>Text and Personal data only. Work stays separate.</p></div></div>
    <p className="muted" style={{marginTop:10}}>Latest: {latestLabel}{latest?' · '+latest.item_count+' items':''}</p>
    <div style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:12}}>
      <Button type="button" variant="outline" disabled={busy} onClick={()=>void createBackup()}>{busy?<LoaderCircle className="spinning"/>:<DatabaseBackup/>}Create backup</Button>
      <Button type="button" variant="outline" disabled={busy||!latest} onClick={()=>void downloadLatest()}><Download/>Download latest</Button>
      <Button type="button" variant="outline" disabled={busy||!latest} onClick={()=>void restoreLatest()}><RotateCcw/>Restore latest</Button>
    </div>
    {message&&<p className="muted" role="status" style={{marginTop:10}}>{message}</p>}
  </section>;
}
