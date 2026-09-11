import 'fake-indexeddb/auto';
import {IDBObjectStore} from 'fake-indexeddb';
import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptCapture,allLocal,cachedItems,capturesFor,putLocal,type Capture} from '../lib/local.ts';
import type {Item} from '../lib/items.ts';
const capture=(id:string,user_id='a'):Capture=>({id,user_id,text:'Remember a thought',captured_at:new Date().toISOString(),time_zone:'America/New_York'});
const row=(capture_id:string,user_id='a'):Item=>({id:'item-'+capture_id,user_id,capture_id,type:'task',title:'Call tomorrow',content:'',area:'People',status:'active',importance:4,urgency:3,due_at:null,parent_id:null,source_text:'Remember a thought',created_at:new Date().toISOString(),updated_at:new Date().toISOString()});
test('Account caches and raw queues are isolated; successful retries merge without duplicates',async()=>{
  const a=capture('one'),b=capture('two','b');
  await putLocal('captures',a);await putLocal('captures',b);
  assert.deepEqual((await capturesFor('a')).map(c=>c.id),['one']);
  await acceptCapture(a,[row('one')]);await acceptCapture(a,[row('one')]);
  assert.equal((await cachedItems('a')).length,1);
  assert.equal((await cachedItems('b')).length,0);
  assert.equal((await capturesFor('a')).length,0);
  assert.equal((await capturesFor('b')).length,1);
});
test('Cross-account or wrong-capture responses preserve the raw capture',async()=>{
  const c=capture('guard');await putLocal('captures',c);
  await assert.rejects(acceptCapture(c,[row('guard','b')]));
  await assert.rejects(acceptCapture(c,[row('different')]));
  assert.ok((await capturesFor('a')).some(c=>c.id==='guard'));
});
test('A cache transaction abort never discards raw audio',async()=>{
  const c={...capture('audio'),audio:new Blob(['audio'],{type:'audio/mp4'})};
  await putLocal('captures',c);
  const original=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(...args:Parameters<typeof original>){
    const result=original.apply(this,args);
    if(this.name==='cache')this.transaction.abort();
    return result;
  };
  try{await assert.rejects(acceptCapture(c,[row('audio')]),/Pending/);}
  finally{IDBObjectStore.prototype.put=original;}
  assert.equal((await capturesFor('a')).find(c=>c.id==='audio')?.audio?.size,5);
  assert.ok(!(await cachedItems('a')).some(i=>i.capture_id==='audio'));
  await acceptCapture(c,[row('audio')]);
  assert.ok(!(await capturesFor('a')).some(c=>c.id==='audio'));
});
test('Local completion wins while a capture receipt is recovered',async()=>{
  const c=capture('status');await putLocal('captures',c);
  await putLocal('changes',{id:'change-status',user_id:'a',item_id:'item-status',status:'completed'});
  const items=await acceptCapture(c,[row('status')]);
  assert.equal(items.find(i=>i.id==='item-status')?.status,'completed');
});

test('Audio bytes survive local storage without depending on Blob serialization',async()=>{
  const c={...capture('safari-audio'),audio:new Blob([new Uint8Array([0,1,128,255])],{type:'audio/mp4'})};
  await putLocal('captures',c);
  const stored=(await allLocal<{id:string;audio?:Blob;audioBytes?:ArrayBuffer}>('captures')).find(item=>item.id===c.id)!;
  assert.equal(stored.audio,undefined);
  assert.ok(stored.audioBytes instanceof ArrayBuffer);
  const restored=(await capturesFor('a')).find(item=>item.id===c.id)!;
  assert.equal(restored.audio?.type,'audio/mp4');
  assert.deepEqual(new Uint8Array(await restored.audio!.arrayBuffer()),new Uint8Array([0,1,128,255]));
});

test('A failed audio save keeps the original available for download and retry',async()=>{
  const c={...capture('failed-recording'),audio:new Blob(['original recording'],{type:'audio/mp4'})};
  const original=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(...args:Parameters<typeof original>){
    if(this.name==='captures')throw new DOMException('Test storage failure','QuotaExceededError');
    return original.apply(this,args);
  };
  try{await assert.rejects(putLocal('captures',c),/Download a copy/);}
  finally{IDBObjectStore.prototype.put=original;}
  assert.equal(await c.audio.text(),'original recording');
  assert.ok(!(await capturesFor('a')).some(item=>item.id===c.id));
  await putLocal('captures',c);
  assert.equal(await (await capturesFor('a')).find(item=>item.id===c.id)!.audio!.text(),'original recording');
});
