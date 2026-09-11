import {PERSONAL_AREAS} from './items.ts';

export const PERSONAL_BACKUP_KIND='dylans-toolbox-personal-backup' as const;
export const PERSONAL_BACKUP_VERSION=1 as const;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const types=new Set(['task','reminder','note','reference','capture']);
const areas=new Set<string>(PERSONAL_AREAS);

type JsonRecord=Record<string,unknown>;
export type PersonalBackupRow={
  id:string;type:'task'|'reminder'|'note'|'reference'|'capture';title:string;content:string;area:string;status:string;
  importance:number;urgency:number;due_at:string|null;due_date:string|null;parent_id:string|null;capture_id:string|null;
  source_text:string;created_at:string;updated_at:string;completed_at:string|null;last_opened_at:string|null;turn_result:unknown;
};
export type PersonalBackup={kind:typeof PERSONAL_BACKUP_KIND;version:typeof PERSONAL_BACKUP_VERSION;exported_at:string;items:PersonalBackupRow[]};

const object=(value:unknown):value is JsonRecord=>!!value&&typeof value==='object'&&!Array.isArray(value);
const nullableString=(value:unknown,max:number)=>value===null||typeof value==='string'&&value.length<=max;
const timestamp=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const nullableTimestamp=(value:unknown)=>value===null||timestamp(value);
const nullableUuid=(value:unknown)=>value===null||typeof value==='string'&&UUID.test(value);

export function personalBackupRow(value:unknown):PersonalBackupRow{
  if(!object(value))throw new Error('Backup contains an invalid record.');
  const type=value.type,area=value.area,status=value.status;
  if(typeof value.id!=='string'||!UUID.test(value.id)||typeof type!=='string'||!types.has(type))throw new Error('Backup contains an invalid item identity.');
  if(typeof area!=='string'||!areas.has(area))throw new Error('This backup is not Personal-only.');
  if(typeof value.title!=='string'||value.title.length<1||value.title.length>180||typeof value.content!=='string'||value.content.length>12000)throw new Error('Backup contains invalid item text.');
  if(typeof value.importance!=='number'||!Number.isInteger(value.importance)||value.importance<1||value.importance>5||typeof value.urgency!=='number'||!Number.isInteger(value.urgency)||value.urgency<1||value.urgency>5)throw new Error('Backup contains invalid priority values.');
  if(typeof status!=='string'||(type==='capture'?!['pending','processed'].includes(status):!['active','completed'].includes(status)))throw new Error('Backup contains an invalid item status.');
  if(!nullableString(value.due_at,80)||!nullableString(value.due_date,10)||!nullableUuid(value.parent_id)||!nullableUuid(value.capture_id))throw new Error('Backup contains invalid links or dates.');
  if(value.due_at!==null&&value.due_date!==null)throw new Error('Backup contains conflicting due dates.');
  if(value.due_at!==null&&!timestamp(value.due_at)||value.due_date!==null&&!/^\d{4}-\d{2}-\d{2}$/.test(value.due_date))throw new Error('Backup contains an invalid due date.');
  if(value.parent_id!==null&&type!=='task')throw new Error('Only tasks can be connected as steps.');
  if(typeof value.source_text!=='string'||value.source_text.length>30000||!timestamp(value.created_at)||!timestamp(value.updated_at)||!nullableTimestamp(value.completed_at)||!nullableTimestamp(value.last_opened_at))throw new Error('Backup contains invalid history metadata.');
  if(value.turn_result!==null&&value.turn_result!==undefined&&!object(value.turn_result))throw new Error('Backup contains invalid conversation history.');
  return {id:value.id,type:type as PersonalBackupRow['type'],title:value.title,content:value.content,area,status,importance:value.importance,urgency:value.urgency,
    due_at:value.due_at as string|null,due_date:value.due_date as string|null,parent_id:value.parent_id as string|null,capture_id:value.capture_id as string|null,
    source_text:value.source_text,created_at:value.created_at,updated_at:value.updated_at,completed_at:(value.completed_at??null) as string|null,last_opened_at:(value.last_opened_at??null) as string|null,turn_result:value.turn_result??null};
}

export function buildPersonalBackup(rows:unknown[],exportedAt=new Date().toISOString()):PersonalBackup{
  if(!timestamp(exportedAt))throw new Error('Backup time is invalid.');
  return {kind:PERSONAL_BACKUP_KIND,version:PERSONAL_BACKUP_VERSION,exported_at:exportedAt,items:rows.map(personalBackupRow)};
}

export function parsePersonalBackup(value:unknown):PersonalBackup{
  if(!object(value)||value.kind!==PERSONAL_BACKUP_KIND||value.version!==PERSONAL_BACKUP_VERSION||!timestamp(value.exported_at)||!Array.isArray(value.items)||value.items.length>20000)throw new Error('This is not a supported Dylan’s Toolbox Personal backup.');
  const items=value.items.map(personalBackupRow);
  if(new Set(items.map(row=>row.id)).size!==items.length)throw new Error('Backup contains duplicate item IDs.');
  return {kind:PERSONAL_BACKUP_KIND,version:PERSONAL_BACKUP_VERSION,exported_at:value.exported_at,items};
}

export function personalRestoreStages(backup:PersonalBackup,existingIds:Set<string>){
  const missing=backup.items.filter(row=>!existingIds.has(row.id));
  const available=new Set([...existingIds,...backup.items.map(row=>row.id)]);
  for(const row of missing){
    if(row.parent_id&&!available.has(row.parent_id))throw new Error('Backup is missing a connected parent task.');
    if(row.capture_id&&!available.has(row.capture_id))throw new Error('Backup is missing source capture history.');
  }
  return [
    missing.filter(row=>row.type==='capture'),
    missing.filter(row=>row.type!=='capture'&&!row.parent_id),
    missing.filter(row=>row.type!=='capture'&&!!row.parent_id),
  ];
}
