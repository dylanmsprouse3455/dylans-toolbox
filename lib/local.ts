import type { Item } from './items';
export type Capture={id:string;user_id:string;text?:string;audio?:Blob;captured_at:string;time_zone:string;error?:string};
export type Change={id:string;user_id:string;item_id:string;status:'active'|'completed'};
type Store='captures'|'changes'|'cache';
type StoredCapture=Omit<Capture,'audio'>&{audio?:Blob;audioBytes?:ArrayBuffer;audioType?:string};
function storageError(error:unknown){
  const name=error&&typeof error==='object'&&'name'in error?String(error.name):'UnknownError';
  return new Error(name==='QuotaExceededError'?'Device storage is full. Download a copy before freeing space.':'Device storage could not save this capture ('+name+'). Keep this window open and download a copy or try again.');
}
let dbPromise:Promise<IDBDatabase>|undefined;
function db() {
  return dbPromise??=new Promise((resolve,reject)=>{
    const req=indexedDB.open('dylans-toolbox',1);
    req.onupgradeneeded=()=>{for(const name of ['captures','changes','cache']) req.result.createObjectStore(name,{keyPath:'id'});};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>{dbPromise=undefined;reject(new Error('Device storage is unavailable. Keep this window open and try again.'));};
  });
}
export async function putLocal(store:Store,value:unknown) {
  // Store audio bytes rather than a browser-managed Blob file. Rebuild the Blob on read.
  if(store==='captures'){
    const capture=value as Capture;
    if(capture.audio){const {audio,...rest}=capture;value={...rest,audioBytes:await audio.arrayBuffer(),audioType:audio.type};}
  }
  const database=await db();
  await new Promise<void>((resolve,reject)=>{
    try{
      const tx=database.transaction(store,'readwrite');
      tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(storageError(tx.error));
      tx.objectStore(store).put(value);
    }catch(e){reject(storageError(e));}
  });
}
export async function removeLocal(store:Store,id:string) {
  const database=await db();
  await new Promise<void>((resolve,reject)=>{const tx=database.transaction(store,'readwrite');tx.objectStore(store).delete(id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
}
export async function allLocal<T>(store:Store):Promise<T[]> {
  const database=await db();
  return new Promise((resolve,reject)=>{const req=database.transaction(store).objectStore(store).getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
}
export async function capturesFor(userId:string){return(await allLocal<StoredCapture>('captures')).filter(c=>c.user_id===userId).map(({audioBytes,audioType,...capture}):Capture=>({...capture,...(audioBytes?{audio:new Blob([audioBytes],{type:audioType||'application/octet-stream'})}:{})}));}
export async function changesFor(userId:string){return(await allLocal<Change>('changes')).filter(c=>c.user_id===userId);}
export async function cachedItems(userId:string):Promise<Item[]>{return(await allLocal<{id:string;items:Item[]}>('cache')).find(c=>c.id===userId)?.items??[];}

// Cache the server receipt and remove the raw capture in ONE committed transaction.
// Any quota error, abort, or interruption leaves the raw capture available to retry.
export async function acceptCapture(capture:Capture,items:Item[]):Promise<Item[]> {
  if(!Array.isArray(items)||items.some(i=>!i||i.user_id!==capture.user_id||i.capture_id!==capture.id)){
    throw new Error('The capture response could not be verified. Your capture is still saved.');
  }
  const database=await db();
  return new Promise((resolve,reject)=>{
    const tx=database.transaction(['cache','captures','changes'],'readwrite');
    const cache=tx.objectStore('cache'),read=cache.get(capture.user_id);
    const changes=tx.objectStore('changes').getAll();
    let next:Item[]=[],reads=0;
    const finish=()=>{
      if(++reads!==2)return;
      const merged=new Map<string,Item>((read.result?.items??[]).map((i:Item)=>[i.id,i]));
      for(const item of items)merged.set(item.id,item);
      next=[...merged.values()];
      for(const change of changes.result as Change[]){
        if(change.user_id!==capture.user_id)continue;
        for(const item of next)if(item.id===change.item_id||item.parent_id===change.item_id)item.status=change.status;
      }
      cache.put({id:capture.user_id,items:next});
      tx.objectStore('captures').delete(capture.id);
    };
    read.onsuccess=finish;changes.onsuccess=finish;
    tx.oncomplete=()=>resolve(next);
    tx.onerror=tx.onabort=()=>reject(new Error('Could not cache the saved result. Your capture remains in Pending and can safely retry.'));
  });
}
