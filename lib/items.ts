export const AREAS = ['Work','Home','Money','Personal','People','Projects','Ideas','Inbox'] as const;
export const PERSONAL_AREAS = ['Home','Money','Personal','People','Projects','Ideas','Inbox'] as const;
export type Area = typeof AREAS[number];
export type ItemType = 'task' | 'reminder' | 'note' | 'reference';
export type PersonalWorkflowState='active'|'waiting';
export type Item = {
  id: string; user_id: string; type: ItemType; title: string; content: string;
  area: Area; status: 'active' | 'completed'; importance: number; urgency: number;
  due_at: string | null; parent_id: string | null; depends_on_id?: string | null; source_text: string;
  due_date?: string | null;
  workflow_state?:PersonalWorkflowState|null; waiting_on?:string|null; follow_up_at?:string|null; follow_up_date?:string|null; highlighted?:boolean|null; visual_asset_id?:string|null;
  capture_id: string | null; created_at: string; updated_at: string;
  completed_at?: string | null; last_opened_at?: string | null;
};
export function actionable(item: Pick<Item,'type'>) { return item.type === 'task' || item.type === 'reminder'; }
export function workflowState(item:Pick<Item,'workflow_state'>):PersonalWorkflowState{return item.workflow_state==='waiting'?'waiting':'active';}
export function dueTime(item:Pick<Item,'due_at'|'due_date'>){return item.due_at?Date.parse(item.due_at):item.due_date?new Date(item.due_date+'T23:59:59').getTime():Infinity;}
export function followUpTime(item:Pick<Item,'follow_up_at'|'follow_up_date'>){return item.follow_up_at?Date.parse(item.follow_up_at):item.follow_up_date?new Date(item.follow_up_date+'T00:00:00').getTime():Infinity;}
export function attentionTime(item:Pick<Item,'workflow_state'|'follow_up_at'|'follow_up_date'|'due_at'|'due_date'>){return workflowState(item)==='waiting'?followUpTime(item):dueTime(item);}
export function waitingReady(item:Pick<Item,'workflow_state'|'follow_up_at'|'follow_up_date'|'updated_at'|'created_at'>,now=Date.now()){
  if(workflowState(item)!=='waiting')return true;
  const follow=followUpTime(item);
  if(Number.isFinite(follow))return follow<=now;
  const since=Date.parse(item.updated_at||item.created_at);
  return Number.isFinite(since)&&now-since>=72*3600000;
}
export function priority(item: Item, now = Date.now()) {
  const hours = (attentionTime(item) - now) / 3600000;
  const seen=Date.parse(item.last_opened_at||item.created_at);
  const unattended=Number.isFinite(seen)?Math.max(0,(now-seen)/3600000):0;
  const staleBoost=unattended>=24?Math.min(70,35+Math.floor((unattended-24)/24)*10):0;
  const waitingBoost=workflowState(item)==='waiting'&&waitingReady(item,now)?30:0;
  const highlightedBoost=item.highlighted?24:0;
  return item.importance * 12 + item.urgency * 8 + (hours < 0 ? 80 : hours <= 24 ? 60 : hours <= 72 ? 35 : hours <= 168 ? 10 : 0) + staleBoost + waitingBoost + highlightedBoost;
}
export function blockedByActiveDependency(item:Pick<Item,'depends_on_id'>,items:Item[]){
  if(!item.depends_on_id)return false;
  const prerequisite=items.find(candidate=>candidate.id===item.depends_on_id);
  return !!prerequisite&&prerequisite.status==='active';
}
export function attention(items: Item[], now = Date.now()) {
  const ranked=items.filter(i => actionable(i) && i.status === 'active' && !i.parent_id && !blockedByActiveDependency(i,items) && waitingReady(i,now) &&
    (i.highlighted || i.importance >= 4 || i.urgency >= 4 || attentionTime(i) <= now + 72 * 3600000 || unopenedForDay(i,now)))
    .sort((a,b) => priority(b, now) - priority(a, now) || attentionTime(a)-attentionTime(b) || a.created_at.localeCompare(b.created_at));
  const chosen=ranked.slice(0,5),stale=ranked.filter(i=>workflowState(i)!=='waiting'&&unopenedForDay(i,now));
  if(stale.length&&chosen.length===5&&!chosen.some(i=>workflowState(i)!=='waiting'&&unopenedForDay(i,now)))chosen[4]=stale[0];
  return chosen.sort((a,b)=>priority(b,now)-priority(a,now)||attentionTime(a)-attentionTime(b)||a.created_at.localeCompare(b.created_at));
}
export function quadrant(item: Pick<Item,'importance'|'urgency'>) {
  return item.importance >= 4 ? (item.urgency >= 4 ? 'Do first' : 'Make time') : (item.urgency >= 4 ? 'Handle soon' : 'For later');
}
export function dueLabel(date: string | null,dateOnly?:string|null) {
  if (!date&&!dateOnly) return null;
  const d = new Date(date||dateOnly+'T12:00:00'), now = new Date();
  const day = d.toLocaleDateString(), today = now.toLocaleDateString();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toLocaleDateString();
  const time = date?', '+d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):'';
  if (day === today) return 'Today' + time;
  if (day === tomorrow) return 'Tomorrow' + time;
  return d.toLocaleDateString([], {month:'short',day:'numeric',...(d.getFullYear() !== now.getFullYear() ? {year:'numeric' as const} : {})})+time;
}
export function followUpLabel(item:Pick<Item,'follow_up_at'|'follow_up_date'>){return dueLabel(item.follow_up_at??null,item.follow_up_date??null);}
export function attentionReason(item:Item,now=Date.now()){
  if(workflowState(item)==='waiting'){
    const follow=followUpTime(item),who=item.waiting_on?.trim();
    if(Number.isFinite(follow)&&follow<=now)return 'Follow-up '+(follow<now-86400000?'overdue':'due')+(who?' · waiting on '+who:'');
    return who?'Waiting on '+who:'Waiting for a response';
  }
  const due=dueTime(item);
  if(item.highlighted&&Number.isFinite(due)&&due<now)return 'Past due · kept highlighted';
  if(Number.isFinite(due)){
    const hours=(due-now)/3600000;
    if(hours<0)return 'Past due';
    if(hours<=24)return 'Due today';
    if(hours<=48)return 'Due tomorrow';
    if(hours<=72)return 'Due soon';
  }
  if(unopenedForDay(item,now)){
    const seen=Date.parse(item.last_opened_at||item.created_at),days=Math.max(1,Math.floor((now-seen)/86400000));
    return `Hasn’t been opened in ${days} ${days===1?'day':'days'}`;
  }
  if(item.importance>=4&&item.urgency>=4)return 'High importance · high urgency';
  if(item.urgency>=4)return 'Needs attention soon';
  if(item.importance>=4)return 'Important';
  return quadrant(item);
}
export function softOverdue(item:Item,today:string){return item.type==='task'&&item.status==='active'&&!item.parent_id&&workflowState(item)==='active'&&!item.highlighted&&!item.due_at&&!!item.due_date&&item.due_date<today;}

export function unopenedForDay(item:Pick<Item,'last_opened_at'|'created_at'|'status'|'type'>,now=Date.now()){
  if(item.status!=='active'||!actionable(item))return false;
  const seen=Date.parse(item.last_opened_at||item.created_at);
  return Number.isFinite(seen)&&now-seen>=24*3600000;
}
export function completionMoment(item:Pick<Item,'completed_at'|'updated_at'>){return item.completed_at||item.updated_at;}
export function completionDayKey(item:Pick<Item,'completed_at'|'updated_at'>){const d=new Date(completionMoment(item));if(Number.isNaN(d.getTime()))return 'unknown';return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
export function completionDayLabel(item:Pick<Item,'completed_at'|'updated_at'>,now=new Date()){
  const d=new Date(completionMoment(item));if(Number.isNaN(d.getTime()))return 'Earlier';
  const diff=Math.round((Date.UTC(now.getFullYear(),now.getMonth(),now.getDate())-Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()))/86400000);
  if(diff===0)return 'Today';if(diff===1)return 'Yesterday';
  return d.toLocaleDateString([],{weekday:'long',month:'short',day:'numeric',year:d.getFullYear()!==now.getFullYear()?'numeric':undefined});
}
