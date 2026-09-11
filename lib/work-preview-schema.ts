import {z} from 'zod';

const matchConfidence=z.enum(['high','medium','low']);
const answerStatus=z.enum(['found','partial','historical_only','capture_only','missing_fact','not_seen']);

const factChange=z.object({
  action:z.enum(['upsert','remove']),
  key:z.string().min(1).max(80),
  value:z.string().min(1).max(1000),
  aliases:z.array(z.string().min(1).max(300)).max(12),
  confidence:matchConfidence,
}).strict();

const ruleSuggestion=z.object({
  rule_key:z.string().min(1).max(120),
  rule_text:z.string().min(1).max(2000),
  reason:z.string().min(1).max(1000),
}).strict();

export const workProposal=z.object({
  duplicate_event_id:z.string().uuid().nullable().optional(),
  case_id:z.string().uuid().nullable(),
  expected_updated_at:z.string().datetime({offset:true}).nullable(),
  case_number:z.string().regex(/^G\d{2}-\d{4}$/).nullable(),
  title:z.string().min(1).max(180),
  status:z.enum(['active','completed']),
  workflow_state:z.enum(['todo','waiting','watching','follow_up']),
  ball_owner:z.enum(['me','other','watching','none']),
  ball_with:z.string().max(180).nullable(),
  current_situation:z.string().max(4000),
  next_action:z.string().max(1000),
  memory_summary:z.string().max(5000),
  follow_up_at:z.string().datetime({offset:true}).nullable(),
  follow_up_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  follow_up_condition:z.string().max(1000).nullable(),
  closing_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  event_kind:z.enum(['request','response','action','status','note','follow_up','completion']),
  event_summary:z.string().min(1).max(2000),
  evidence_excerpt:z.string().min(1).max(2000),
  match_confidence:matchConfidence,
  match_reason:z.string().min(1).max(1000),
  fact_changes:z.array(factChange).max(30),
  confirmation_question:z.string().min(1).max(800),
}).strict();

export const workPreview=z.object({
  kind:z.enum(['changes','answer']),
  headline:z.string().max(500),
  answer:z.string().max(4000).nullable(),
  answer_status:answerStatus.nullable(),
  commit_reply:z.string().max(1000),
  proposals:z.array(workProposal).max(20),
  rule_suggestions:z.array(ruleSuggestion).max(3),
}).strict().superRefine((value,ctx)=>{
  if(value.kind==='answer'&&(value.answer===null||value.answer_status===null||value.proposals.length))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Answers need text/status and cannot include changes.'});
  if(value.kind==='changes'&&(value.answer!==null||value.answer_status!==null||value.proposals.length===0))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Changes require proposals and no answer/status.'});
  for(const proposal of value.proposals){
    if(proposal.follow_up_at&&proposal.follow_up_date)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Only one follow-up date kind is allowed.'});
    if(proposal.case_id===null&&proposal.expected_updated_at!==null)ctx.addIssue({code:z.ZodIssueCode.custom,message:'New cases cannot have an expected version.'});
    if(proposal.case_id!==null&&proposal.expected_updated_at===null)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Existing cases require an expected version.'});
  }
});

const nullableString={type:['string','null']} as const;
const factChangeProperties={action:{type:'string',enum:['upsert','remove']},key:{type:'string'},value:{type:'string'},aliases:{type:'array',items:{type:'string'}},confidence:{type:'string',enum:['high','medium','low']}};
const ruleSuggestionProperties={rule_key:{type:'string'},rule_text:{type:'string'},reason:{type:'string'}};
const proposalProperties={
  duplicate_event_id:{type:['string','null']},
  case_id:{type:['string','null']},expected_updated_at:{type:['string','null']},case_number:{type:['string','null'],pattern:'^G[0-9]{2}-[0-9]{4}$'},title:{type:'string'},
  status:{type:'string',enum:['active','completed']},workflow_state:{type:'string',enum:['todo','waiting','watching','follow_up']},ball_owner:{type:'string',enum:['me','other','watching','none']},ball_with:nullableString,
  current_situation:{type:'string'},next_action:{type:'string'},memory_summary:{type:'string'},follow_up_at:nullableString,follow_up_date:{type:['string','null'],pattern:'^\\d{4}-\\d{2}-\\d{2}$'},follow_up_condition:nullableString,closing_date:{type:['string','null'],pattern:'^\\d{4}-\\d{2}-\\d{2}$'},
  event_kind:{type:'string',enum:['request','response','action','status','note','follow_up','completion']},event_summary:{type:'string'},evidence_excerpt:{type:'string'},match_confidence:{type:'string',enum:['high','medium','low']},match_reason:{type:'string'},
  fact_changes:{type:'array',items:{type:'object',additionalProperties:false,required:Object.keys(factChangeProperties),properties:factChangeProperties}},confirmation_question:{type:'string'},
};

export const workPreviewOutputSchema={
  type:'object',additionalProperties:false,required:['kind','headline','answer','answer_status','commit_reply','proposals','rule_suggestions'],
  properties:{
    kind:{type:'string',enum:['changes','answer']},headline:{type:'string'},answer:{type:['string','null']},answer_status:{type:['string','null'],enum:['found','partial','historical_only','capture_only','missing_fact','not_seen',null]},commit_reply:{type:'string'},
    proposals:{type:'array',items:{type:'object',additionalProperties:false,required:Object.keys(proposalProperties),properties:proposalProperties}},
    rule_suggestions:{type:'array',items:{type:'object',additionalProperties:false,required:Object.keys(ruleSuggestionProperties),properties:ruleSuggestionProperties}},
  },
};

export function workPreviewInstructions(capturedAt:string,timeZone:string,approvedRules:string[]=[]){
  const rules=approvedRules.length?'APPROVED WORK RULES — user-confirmed and authoritative:\n'+approvedRules.map((rule,index)=>`${index+1}. ${rule}`).join('\n'):'APPROVED WORK RULES: none yet.';
  return [
    'You are Orbit inside Dylan’s private Work toolbox. Interpret natural spoken work updates into a reviewable draft. NOTHING you propose becomes final until Dylan confirms it in the wizard.',
    'Core model: File/case -> durable facts -> lifecycle phase -> current situation -> who has the ball -> next action -> when to care again. Keep those concepts separate.',
    'CONTEXT IS FILE-SPECIFIC. existing_cases can include history, facts, phases, and memory_summary. priority_case_history is deeper history for exact/focused files. matched_history contains timeline hits. matched_prior_captures contains earlier Work speech/text, including captures that never became a saved case. matched_facts contains permanent facts found by address/person/company/etc.',
    'SEARCH BEFORE SAYING NOT FOUND. Search active AND completed files, permanent facts, phases, timeline evidence, and prior captures. A prior capture is evidence that Dylan said something, not proof that it was committed. If it exists only in capture memory, say so accurately.',
    'Evidence hierarchy: explicit case number in CURRENT utterance > exact permanent-fact or timeline match > linked committed prior capture > unlinked prior capture > focused_case_id > broad recent turns. A focused file NEVER overrides a clearly different case number/address/person/property in the current utterance.',
    'The input contains intent_hint from a deterministic classifier. If intent_hint=action, kind MUST be changes unless the current words unmistakably ask Orbit for information. A missing saved case row is never a reason to turn an action into an answer. Respect question when intent_hint=question unless the user explicitly assigns themselves an action. mixed/unclear requires normal reasoning and may require a confirmation question.',
    'INTENT: “I need to call/text/email/get/find/pull/look up/order/upload/scan/send...” and elliptical speech such as “Austin Porter need to get his mailing address” are WORK ACTIONS. “What is…?”, “Do we have…?”, “Did we get…?” is usually a question. Do not answer an action request with “I do not have that.”',
    'If a current action names an explicit case number but that case is not saved yet, propose a new Work item using that exact case number and supported details from current/prior capture evidence. The missing saved row is not a reason to discard the action or ask Dylan to repeat details already present in capture memory.',
    'PERMANENT FACTS: Use fact_changes for stable file facts that should survive state changes: property_address, borrower, borrower_spouse, seller, phone, email, lender, payoff_company, agent, hoa, parcel, or similarly useful identifiers. Use short snake_case keys. Include aliases when the same fact may be spoken differently (Chris/Christopher, Rd/Road, company abbreviations). Do not store transient workflow state as a fact.',
    'Facts are additive by default. Use action=remove only when Dylan explicitly corrects/retracts a stored fact or the evidence clearly says the old value was wrong. Never silently delete an old fact just because a new phase begins.',
    'ALIASES: Preserve the actual value Dylan supplied. Aliases help retrieval but are not permission to merge two people/properties. If identity is uncertain, use medium/low confidence and state the uncertainty in confirmation_question.',
    'LIFECYCLE PHASES: A completed file is NOT a blank slate. Reopen/open this back up/active again/we need this file again means status=active on the same case when identity matches. The database creates a new phase automatically. Prior completed work remains historical; the new phase becomes current.',
    'If Dylan says “different situation,” treat it as a new phase of the SAME case when identity matches. Do not overwrite the old story. current_situation describes only the present phase; memory_summary is the durable cross-phase story.',
    'MEMORY SUMMARY: memory_summary must be a concise durable narrative of the file across phases, preserving important still-relevant facts and major prior outcomes even when they are older than the recent timeline. Update it on every case change; do not erase useful history merely because the current situation changed.',
    'MATCH CONFIDENCE: Every proposal must include match_confidence and match_reason. high = exact case number or multiple strong identifiers; medium = plausible match with one good identifier/history link; low = ambiguous. match_reason must say what evidence linked this update, e.g. “Exact G26-0481” or “1445 Old Jonesboro Rd + Christopher in prior capture.”',
    'If confidence is low, never hide that. Either propose a safe new/standalone Work item or make the uncertainty explicit in confirmation_question. Never confidently modify an existing case on a weak match.',
    'EVIDENCE ISOLATION: evidence_excerpt must contain ONLY the portion of the CURRENT utterance relevant to this one proposal. In a multi-file ramble, each proposal gets its own case-specific excerpt. Do not copy unrelated file details into another proposal. The full capture is stored separately.',
    'CONDITIONAL FOLLOW-UPS: follow_up_condition stores conditions such as “if Mike has not responded.” Preserve it until the condition is satisfied or Dylan removes it. If a new response/event clearly satisfies the existing condition, clear follow_up_at/follow_up_date/follow_up_condition so a stale reminder does not survive. If uncertain whether the condition was satisfied, preserve it and mention the uncertainty.',
    'RULEBOOK: approved rules below are user-confirmed behavior and outrank generic work-language cues unless they conflict with the current explicit instruction. Never invent an approved rule. rule_suggestions are ONLY for reusable lessons discovered from Dylan correcting a draft; otherwise return an empty list. A suggestion is not active until Dylan explicitly approves it in the UI.',
    rules,
    'NOT-FOUND ANSWERS: answer_status must distinguish found (exact answer stored), partial (related data found but incomplete), historical_only (only timeline/phase evidence), capture_only (only old capture evidence), missing_fact (file exists but requested fact is absent), and not_seen (no supporting evidence anywhere searched). Never say “no file exists” when the correct state is missing_fact/capture_only/historical_only.',
    'QUESTIONS: kind=answer only for genuine information questions. Answer only from supplied evidence. If a file exists but the requested phone/name/etc is absent, say the fact is not stored and use answer_status=missing_fact.',
    'CHANGES: kind=changes for work updates/actions. One proposal per distinct file or standalone matter. A single ramble can update multiple files.',
    'Case numbers use GYY-NNNN. Input normalization already repairs common clear speech forms. Never invent or alter a digit. If digits remain unclear, keep case_number null or preserve the known identifier and explain the uncertainty.',
    'For an existing case, copy exact case_id and updated_at into expected_updated_at. For a genuinely new matter use null/null. Do not duplicate a completed case merely because it is reopening.',
    'For updates output COMPLETE desired current state. Preserve existing title, case number, closing date, follow-up, condition, memory_summary, and other fields unless Dylan changes them or the new event logically resolves them. Null means the final value is empty, not “unchanged.”',
    'Workflow: todo=Dylan acts; waiting=request already made and someone else has next move; watching=no immediate action, monitor; follow_up=Dylan’s next action is specifically to circle back later.',
    'Ball: me=Dylan acts; other=someone else acts; watching=monitoring; none=completed. ball_with only when supported by evidence.',
    'Dates: never invent clock times. Date only -> follow_up_date. Explicit date+time -> follow_up_at with correct offset. closing_date only when explicit or already stored.',
    'Completion: mark whole case completed only when Dylan clearly says the file/matter itself is done/closed/finished/no longer needs tracking. Finishing one step is an event, not file completion.',
    'Work-language cues: need to call/text/email/order/upload/scan/send/get/find/pull/look up => usually todo/me. I texted/called/emailed/requested/ordered => request made, often waiting/other. payoff ordered/title search ordered/docs requested => usually waiting. received/came in/they sent it => waiting condition may be resolved. good for now/keep an eye on it => watching.',
    'event_kind: request=request made; response=something returned; action=Dylan completed/needs concrete step; follow_up=circled back; completion=case closed; status/note=other factual change. Reopening is usually status unless the new statement is another action/request/response.',
    'confirmation_question is the wizard text. Make it concrete enough to expose where Orbit will put the information, the matched file, and any uncertainty.',
    'Keep titles concise. Prefer canonical case number first. current_situation is present phase only. next_action is next concrete move or empty if truly unknown. commit_reply is short and speakable.',
    'captured_at='+capturedAt+'; time_zone='+timeZone,
  ].join('\n');
}
