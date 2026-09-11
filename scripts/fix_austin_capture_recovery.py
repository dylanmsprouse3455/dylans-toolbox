from pathlib import Path

def replace_once(path, old, new):
    p=Path(path); s=p.read_text()
    if new in s: return
    if old not in s: raise SystemExit(f'Missing patch target in {path}: {old[:100]}')
    p.write_text(s.replace(old,new,1))

replace_once('lib/work-context.ts',
"  const action=/\\b(i|we)\\s+(need|have|got)\\s+to\\b|\\bremind me\\b|\\badd (?:this|that|a)\\b|\\bmake (?:this|that)\\b|\\bi should\\b|\\bi've got to\\b|\\bi gotta\\b/.test(text);",
"  const action=/\\b(i|we)\\s+(need|have|got)\\s+to\\b|\\b(?:need|needs|gotta|have)\\s+to\\s+(?:call|text|email|get|find|pull|look\\s+up|order|upload|scan|send|obtain|request|contact|follow\\s+up)\\b|\\bremind me\\b|\\badd (?:this|that|a)\\b|\\bmake (?:this|that)\\b|\\bi should\\b|\\bi've got to\\b|\\bi gotta\\b/.test(text);")

replace_once('lib/work-capture-handler.ts',
"  const preview=await askOpenAI(c,client,normalizeWorkCaseNumbers(interpretation.summary),root.captured_at,root.time_zone,root.focus_case_id??undefined,priorResult?.preview,refresh?'Refresh against current case data; preserve the organized meaning.':version.correction??undefined,bundle);",
"  const preview=await askOpenAI(c,client,normalizeWorkCaseNumbers(root.raw_transcript),root.captured_at,root.time_zone,root.focus_case_id??undefined,priorResult?.preview,refresh?'Refresh against current case data; preserve the organized meaning.':version.correction??undefined,bundle);")

replace_once('lib/work-organized.ts',
"import {z} from 'zod';",
"import {z} from 'zod';\nimport {normalizeWorkCaseNumbers} from './work-context.ts';")
replace_once('lib/work-organized.ts',
"    item.source_excerpt=exactExcerpt;\n    if(item.date_wording){",
"    item.source_excerpt=exactExcerpt;\n    const sourceCaseNumbers=[...new Set(normalizeWorkCaseNumbers(item.source_excerpt).toUpperCase().match(/G\\d{2}-\\d{4}/g)??[])];\n    if(sourceCaseNumbers.length)item.case_numbers=sourceCaseNumbers;\n    if(item.date_wording){")

replace_once('lib/work-preview-schema.ts',
"    'The input contains intent_hint from a deterministic classifier. Respect action when intent_hint=action unless the words unmistakably ask Orbit for information. Respect question when intent_hint=question unless the user explicitly assigns themselves an action. mixed/unclear requires normal reasoning and may require a confirmation question.',",
"    'The input contains intent_hint from a deterministic classifier. If intent_hint=action, kind MUST be changes unless the current words unmistakably ask Orbit for information. A missing saved case row is never a reason to turn an action into an answer. Respect question when intent_hint=question unless the user explicitly assigns themselves an action. mixed/unclear requires normal reasoning and may require a confirmation question.',")
replace_once('lib/work-preview-schema.ts',
"    'INTENT: “I need to call/text/email/get/find/pull/look up/order/upload/scan/send...” is usually a WORK ACTION. “What is…?”, “Do we have…?”, “Did we get…?” is usually a question. Do not answer an action request with “I do not have that.”',",
"    'INTENT: “I need to call/text/email/get/find/pull/look up/order/upload/scan/send...” and elliptical speech such as “Austin Porter need to get his mailing address” are WORK ACTIONS. “What is…?”, “Do we have…?”, “Did we get…?” is usually a question. Do not answer an action request with “I do not have that.”',\n    'If a current action names an explicit case number but that case is not saved yet, propose a new Work item using that exact case number and supported details from current/prior capture evidence. The missing saved row is not a reason to discard the action or ask Dylan to repeat details already present in capture memory.',")

replace_once('tests/work-context.test.ts',
"  assert.equal(workIntentHint('Did we get the payoff?'),'question');",
"  assert.equal(workIntentHint('Did we get the payoff?'),'question');\n  assert.equal(workIntentHint('So there is a G 20 60232 Austin Porter need to get his mailing address'),'action');")

p=Path('tests/work-organized-evidence.test.ts'); s=p.read_text()
marker="test('organized evidence still rejects a semantic paraphrase that is not in the source',()=>{"
addition="""test('organized evidence corrects model case-number drift from the source transcript',()=>{\n  const driftRaw='So there is a G 20 60232 Austin Porter need to get his mailing address';\n  const driftBundle:CaptureBundle={capture:{...bundle.capture,id:'67e34ec5-e79b-4ad4-93d5-fb9e39a3e8b2',raw_transcript:driftRaw},versions:[]};\n  const result=validateOrganizedCapture({summary:'There is a G20-6023 associated with Austin Porter and his mailing address is needed.',entries:[{kind:'action',text:\"Need to get Austin Porter's mailing address.\",case_numbers:['G20-6023'],people:['Austin Porter'],property:null,truth_status:'current',source:'raw_transcript',source_version:1,source_excerpt:driftRaw,date_wording:null,resolved_date:null,resolved_at:null}]},driftBundle);\n  assert.deepEqual(result.entries[0].case_numbers,['G26-0232']);\n});\n\n"""
if addition not in s:
    if marker not in s: raise SystemExit('Missing organized evidence test marker')
    p.write_text(s.replace(marker,addition+marker,1))
