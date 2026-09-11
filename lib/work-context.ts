export type WorkState='todo'|'waiting'|'watching'|'follow_up';

export function normalizeWorkCaseNumbers(input:string){
  let text=input;
  // Speech recognition sometimes turns "twenty six" into "20 6".
  text=text.replace(/\b[gG]\s*[-:]?\s*20\s*[- ]?\s*(\d)\s*[- ]?\s*(\d{4})\b/g,(_match,yearDigit,sequence)=>`G2${yearDigit}-${sequence}`);
  // Standard spaced, hyphenated, or run-together forms: G 26 0441 / G26-0441 / G260441.
  text=text.replace(/\b[gG]\s*[-:]?\s*(\d{2})\s*[- ]?\s*(\d{4})\b/g,(_match,year,sequence)=>`G${year}-${sequence}`);
  // Individually recognized digits: G 2 6 0 4 4 1.
  text=text.replace(/\b[gG]\s*[-:]?\s*(\d)\s*[- ]\s*(\d)\s*[- ]\s*(\d)\s*[- ]\s*(\d)\s*[- ]\s*(\d)\s*[- ]\s*(\d)\b/g,
    (_match,a,b,c,d,e,f)=>`G${a}${b}-${c}${d}${e}${f}`);
  return text;
}

const statePattern=/^WORK_STATE:\s*(todo|waiting|watching|follow_up)\s*\n?/i;

export function workState(content:string):WorkState{
  const match=content.match(statePattern);
  return match?.[1]?.toLowerCase() as WorkState||'todo';
}

export function workContent(content:string){
  return content.replace(statePattern,'').trim();
}

export function withWorkState(content:string,state:WorkState){
  return `WORK_STATE: ${state}\n${workContent(content)}`.trim();
}
