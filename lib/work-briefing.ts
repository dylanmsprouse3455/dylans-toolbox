import type {WorkCase} from './work-types.ts';

export type WorkBriefingGroupKey='needs_you'|'due_soon'|'waiting'|'watching'|'recently_completed';

export type WorkBriefingGroup={
  key:WorkBriefingGroupKey;
  label:string;
  items:WorkCase[];
};

export type WorkBriefing={
  needsYou:number;
  dueSoon:number;
  waiting:number;
  watching:number;
  groups:WorkBriefingGroup[];
};

const DAY=86400000;

function endOfDate(date:string){return new Date(date+'T23:59:59').getTime();}

export function followUpMoment(item:Pick<WorkCase,'follow_up_at'|'follow_up_date'>){
  if(item.follow_up_at)return Date.parse(item.follow_up_at);
  if(item.follow_up_date)return endOfDate(item.follow_up_date);
  return Infinity;
}

export function closingMoment(item:Pick<WorkCase,'closing_date'>){
  return item.closing_date?endOfDate(item.closing_date):Infinity;
}

export function nextTimeSensitiveMoment(item:WorkCase){
  return Math.min(followUpMoment(item),closingMoment(item));
}

function activeBucket(item:WorkCase,now:number):Exclude<WorkBriefingGroupKey,'recently_completed'>{
  const due=nextTimeSensitiveMoment(item);
  if(due<=now)return 'needs_you';
  if(Number.isFinite(due)&&due<=now+3*DAY)return 'due_soon';
  if(item.workflow_state==='waiting'||item.ball_owner==='other')return 'waiting';
  if(item.workflow_state==='watching'||item.workflow_state==='follow_up'||item.ball_owner==='watching')return 'watching';
  if(item.ball_owner==='me'||item.workflow_state==='todo')return 'needs_you';
  return 'watching';
}

function urgencySort(a:WorkCase,b:WorkCase){
  const dueA=nextTimeSensitiveMoment(a),dueB=nextTimeSensitiveMoment(b);
  if(dueA!==dueB)return dueA-dueB;
  return Date.parse(b.last_event_at)-Date.parse(a.last_event_at);
}

export function buildWorkBriefing(cases:WorkCase[],now=Date.now()):WorkBriefing{
  const active=cases.filter(item=>item.status==='active');
  const buckets:Record<Exclude<WorkBriefingGroupKey,'recently_completed'>,WorkCase[]>={needs_you:[],due_soon:[],waiting:[],watching:[]};
  for(const item of active)buckets[activeBucket(item,now)].push(item);
  for(const key of Object.keys(buckets) as Array<keyof typeof buckets>)buckets[key].sort(urgencySort);

  const completed=cases
    .filter(item=>item.status==='completed')
    .sort((a,b)=>Date.parse(b.last_event_at)-Date.parse(a.last_event_at))
    .slice(0,4);

  const groups:WorkBriefingGroup[]=[
    {key:'needs_you',label:'Needs you',items:buckets.needs_you},
    {key:'due_soon',label:'Due soon',items:buckets.due_soon},
    {key:'waiting',label:'Waiting',items:buckets.waiting},
    {key:'watching',label:'Watching',items:buckets.watching},
    {key:'recently_completed',label:'Recently completed',items:completed},
  ].filter(group=>group.items.length>0) as WorkBriefingGroup[];

  return {
    needsYou:buckets.needs_you.length,
    dueSoon:buckets.due_soon.length,
    waiting:buckets.waiting.length,
    watching:buckets.watching.length,
    groups,
  };
}
