import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const DB_NAME='dylans-toolbox';

function deleteDb(){
  return new Promise<void>((resolve,reject)=>{
    const request=indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess=()=>resolve();
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('IndexedDB delete was blocked'));
  });
}

function makeLegacyDb(){
  return new Promise<void>((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{
      const captures=request.result.createObjectStore('captures',{keyPath:'id'});
      captures.put({id:'legacy-capture',user_id:'owner-1',text:'keep me',captured_at:'2026-09-12T15:00:00.000Z',time_zone:'America/New_York'});
    };
    request.onsuccess=()=>{request.result.close();resolve();};
    request.onerror=()=>reject(request.error);
  });
}

test('repairs a version-1 Toolbox database that is missing newer object stores without deleting legacy captures',async()=>{
  await deleteDb();
  await makeLegacyDb();

  const local=await import('../lib/local.ts?indexeddb-upgrade-regression');
  const captures=await local.capturesFor('owner-1');
  assert.equal(captures.length,1);
  assert.equal(captures[0]?.id,'legacy-capture');
  assert.equal(captures[0]?.text,'keep me');

  await local.putLocal('cache',{id:'owner-1',items:[]});
  await local.putLocal('changes',{id:'change-1',user_id:'owner-1',item_id:'item-1',status:'active'});

  const request=indexedDB.open(DB_NAME);
  const database=await new Promise<IDBDatabase>((resolve,reject)=>{
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
  assert.equal(database.version,2);
  assert.deepEqual([...database.objectStoreNames].sort(),['cache','captures','changes']);
  database.close();
});
