type VoiceEngine={
  cancel:()=>void;
  speak:(utterance:SpeechSynthesisUtterance)=>void;
  getVoices?:()=>SpeechSynthesisVoice[];
};

type VoiceOptions={
  engine?:VoiceEngine;
  createUtterance?:(text:string)=>SpeechSynthesisUtterance;
};

export function stopSpeaking(engine?:Pick<VoiceEngine,'cancel'>){
  const output=engine??(typeof window!=='undefined'&&'speechSynthesis'in window?window.speechSynthesis:undefined);
  output?.cancel();
}

export function speakReply(text:string,options:VoiceOptions={}):boolean{
  const reply=text.replace(/\s+/g,' ').trim();
  const engine=options.engine??(typeof window!=='undefined'&&'speechSynthesis'in window?window.speechSynthesis:undefined);
  const create=options.createUtterance??(typeof SpeechSynthesisUtterance!=='undefined'?(value:string)=>new SpeechSynthesisUtterance(value):undefined);
  if(!reply||!engine||!create)return false;
  const utterance=create(reply);
  utterance.lang='en-US';utterance.rate=.97;utterance.pitch=1;utterance.volume=1;
  const voices=engine.getVoices?.()??[];
  utterance.voice=voices.find(voice=>voice.lang.toLowerCase()==='en-us'&&voice.default)??voices.find(voice=>voice.lang.toLowerCase().startsWith('en'))??null;
  engine.cancel();engine.speak(utterance);
  return true;
}

