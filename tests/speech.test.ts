import test from 'node:test';
import assert from 'node:assert/strict';
import {speakReply,stopSpeaking} from '../lib/speech.ts';

test('Voice replies normalize text, select an English voice, and replace earlier speech',()=>{
  const spoken:{text:string;lang:string;rate:number;voice:{lang:string;default:boolean}|null}[]=[];
  let cancelled=0;
  const voices=[{lang:'es-MX',default:true},{lang:'en-GB',default:false},{lang:'en-US',default:true}];
  const engine={cancel:()=>{cancelled++;},speak:(value:unknown)=>spoken.push(value as typeof spoken[number]),getVoices:()=>voices};
  const createUtterance=(text:string)=>({text,lang:'',rate:1,pitch:1,volume:1,voice:null}) as unknown as SpeechSynthesisUtterance;
  assert.equal(speakReply('  I updated   Catnip for tomorrow at 3 PM. ',{engine:engine as never,createUtterance}),true);
  assert.equal(cancelled,1);assert.equal(spoken[0].text,'I updated Catnip for tomorrow at 3 PM.');
  assert.equal(spoken[0].lang,'en-US');assert.equal(spoken[0].rate,.97);assert.equal(spoken[0].voice?.lang,'en-US');
  stopSpeaking(engine);assert.equal(cancelled,2);
});

test('Voice replies safely skip empty text',()=>{
  const engine={cancel:()=>{},speak:()=>{},getVoices:()=>[]};
  const createUtterance=(text:string)=>({text}) as SpeechSynthesisUtterance;
  assert.equal(speakReply('',{engine:engine as never,createUtterance}),false);
});

