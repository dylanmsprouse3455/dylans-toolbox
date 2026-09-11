import type {WorkIntentHint} from './work-types.ts';

export type WorkState='todo'|'waiting'|'watching'|'follow_up';

export function normalizeWorkCaseNumbers(input:string){
  let text=input;
  text=text.replace(/\b[gG]\s*[-:]?\s*20\s*[- ]?\s*(\d)\s*[- ]?\s*(\d{4})\b/g,(_match,yearDigit,sequence)=>`G2${yearDigit}-${sequence}`);
  text=text.replace(/\b[gG]\s*[-:]?\s*(\d{2})\s*(?:is|as|it\s+is|it's)\s*[- ]?\s*(\d{4})\b/gi,(_match,year,sequence)=>`G${year}-${sequence}`);
  text=text.replace(/\b[gG]\s*[-:]?\s*(\d{2})\s*[- ]?\s*(\d{4})\b/g,(_match,year,sequence)=>`G${year}-${sequence}`);
  text=text.replace(/\b[gG]\s*[-:]?\s*(\d)\s*[- ]\s*(\d)\s*[- ]\s*(\d)\s*[- ]\s*(\d)\s*[- ]\s*(\d)\s*[- ]\s*(\d)\b/g,(_match,a,b,c,d,e,f)=>`G${a}${b}-${c}${d}${e}${f}`);
  return text;
}

export function normalizeWorkEntity(input:string){
  return input.toLowerCase().replace(/\broad\b/g,'rd').replace(/\bstreet\b/g,'st').replace(/\bdrive\b/g,'dr').replace(/\bhighway\b/g,'hwy').replace(/[^a-z0-9]+/g,'').trim();
}

export function workIntentHint(input:string):WorkIntentHint{
  const text=input.trim().toLowerCase();
  const action=/\b(i|we)\s+(need|have|got)\s+to\b|\bremind me\b|\badd (?:this|that|a)\b|\bmake (?:this|that)\b|\bi should\b|\bi've got to\b|\bi gotta\b/.test(text);
  const question=/\?$|^(what|where|when|who|why|how|did|do|does|is|are|was|were|can|could|have|has)\b/.test(text)||/\bdo (?:we|i) have\b|\bdid (?:we|i) get\b|\bwhat(?:'s| is) the\b/.test(text);
  if(action&&question)return 'mixed';
  if(action)return 'action';
  if(question)return 'question';
  return 'unclear';
}

const statePattern=/^WORK_STATE:\s*(todo|waiting|watching|follow_up)\s*\n?/i;
export function isManagedWorkContent(content:string){return statePattern.test(content);}
export function workState(content:string):WorkState{const match=content.match(statePattern);return match?.[1]?.toLowerCase() as WorkState||'todo';}
export function workContent(content:string){return content.replace(statePattern,'').trim();}
export function withWorkState(content:string,state:WorkState){return `WORK_STATE: ${state}\n${workContent(content)}`.trim();}
