export function appendSpeech(current:string,next:string){
  const addition=next.replace(/\s+/g,' ').trim();
  return addition?[current.trim(),addition].filter(Boolean).join(' '):current.trim();
}

export function thoughtLines(finalText:string,interimText:string){
  const text=[finalText,interimText].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
  if(!text)return [];
  const parts=text.split(/(?<=[.!?])\s+/).map(part=>part.trim()).filter(Boolean);
  return parts.slice(-5);
}

