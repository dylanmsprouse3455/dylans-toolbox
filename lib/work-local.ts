// A text-only recovery queue, separate from Personal's existing IndexedDB stores.
export type PendingWorkText={id:string;user_id:string;text:string;captured_at:string;time_zone:string;focus_case_id:string|null};
async function database(){return new Promise<IDBDatabase>((resolve,reject)=>{
  const request=indexedDB.open('dylans-work-text',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('pending',{keyPath:'id'}).createIndex('owner','user_id');
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});}
export async function savePendingWorkText(input:PendingWorkText){
  if(typeof input.text!=='string'||!input.text.trim())throw new Error('Only Work text can be saved.');
  // Explicit fields: Blob, audio bytes and other properties can never enter storage.
  const row={id:input.id,user_id:input.user_id,text:input.text,captured_at:input.captured_at,time_zone:input.time_zone,focus_case_id:input.focus_case_id};
  const db=await database();try{await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction('pending','readwrite'),store=tx.objectStore('pending'),existing=store.get(row.id);
    existing.onsuccess=()=>{if(existing.result&&(existing.result.user_id!==row.user_id||existing.result.text!==row.text)){tx.abort();return;}store.put(row);};
    tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(new Error('Could not save Work text on this device. The original text is still on screen.'));
  });}finally{db.close();}
}
export async function pendingWorkText(owner:string):Promise<PendingWorkText[]>{
  const db=await database();try{return await new Promise((resolve,reject)=>{const request=db.transaction('pending').objectStore('pending').index('owner').getAll(owner);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}finally{db.close();}
}
export async function removePendingWorkText(id:string,owner:string){
  const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('pending','readwrite'),store=tx.objectStore('pending'),request=store.get(id);request.onsuccess=()=>{if(request.result?.user_id===owner)store.delete(id);};tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error);});}finally{db.close();}
}
