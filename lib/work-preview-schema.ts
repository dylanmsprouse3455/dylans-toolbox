import {z} from 'zod';

export const workProposal=z.object({
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
  follow_up_at:z.string().datetime({offset:true}).nullable(),
  follow_up_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  closing_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  event_kind:z.enum(['request','response','action','status','note','follow_up','completion']),
  event_summary:z.string().min(1).max(2000),
  confirmation_question:z.string().min(1).max(800),
}).strict();

export const workPreview=z.object({
  kind:z.enum(['changes','answer']),
  headline:z.string().max(500),
  answer:z.string().max(4000).nullable(),
  commit_reply:z.string().max(1000),
  proposals:z.array(workProposal).max(20),
}).strict().superRefine((value,ctx)=>{
  if(value.kind==='answer'&&(value.answer===null||value.proposals.length))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Answers cannot include changes.'});
  if(value.kind==='changes'&&(value.answer!==null||value.proposals.length===0))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Changes require proposals and no answer.'});
  for(const proposal of value.proposals){
    if(proposal.follow_up_at&&proposal.follow_up_date)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Only one follow-up date kind is allowed.'});
    if(proposal.case_id===null&&proposal.expected_updated_at!==null)ctx.addIssue({code:z.ZodIssueCode.custom,message:'New cases cannot have an expected version.'});
    if(proposal.case_id!==null&&proposal.expected_updated_at===null)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Existing cases require an expected version.'});
  }
});

const nullableString={type:['string','null']} as const;
const proposalProperties={
  case_id:{type:['string','null']},
  expected_updated_at:{type:['string','null']},
  case_number:{type:['string','null'],pattern:'^G[0-9]{2}-[0-9]{4}$'},
  title:{type:'string'},
  status:{type:'string',enum:['active','completed']},
  workflow_state:{type:'string',enum:['todo','waiting','watching','follow_up']},
  ball_owner:{type:'string',enum:['me','other','watching','none']},
  ball_with:nullableString,
  current_situation:{type:'string'},
  next_action:{type:'string'},
  follow_up_at:nullableString,
  follow_up_date:{type:['string','null'],pattern:'^\\d{4}-\\d{2}-\\d{2}$'},
  closing_date:{type:['string','null'],pattern:'^\\d{4}-\\d{2}-\\d{2}$'},
  event_kind:{type:'string',enum:['request','response','action','status','note','follow_up','completion']},
  event_summary:{type:'string'},
  confirmation_question:{type:'string'},
};

export const workPreviewOutputSchema={
  type:'object',additionalProperties:false,
  required:['kind','headline','answer','commit_reply','proposals'],
  properties:{
    kind:{type:'string',enum:['changes','answer']},
    headline:{type:'string'},
    answer:{type:['string','null']},
    commit_reply:{type:'string'},
    proposals:{type:'array',items:{type:'object',additionalProperties:false,required:Object.keys(proposalProperties),properties:proposalProperties}},
  },
};

export function workPreviewInstructions(capturedAt:string,timeZone:string){
  return [
    'You are Orbit inside Dylan’s private Work toolbox. Your job is to interpret natural spoken work updates into a reviewable draft. NOTHING you propose is final until Dylan confirms it in the wizard.',
    'The core model is: File or case -> current situation -> who has the ball -> next action -> when to care again. Use that model for every proposed change.',
    'CONTEXT IS FILE-SPECIFIC. Each object in existing_cases may include a history array for that exact file, newest event first. priority_case_history contains deeper history for the focused file or an explicitly named case number. Use that history before relying on broad recent turns.',
    'Treat the case record and its timeline as one continuous memory. A completed file is NOT a blank slate. If Dylan reopens it, continue the same case_id and use its prior timeline to understand what the file was, what was completed, and what has changed now.',
    'REOPENING RULE: Words such as reopen, open this back up, this is active again, or we need this file again mean status=active on the existing case unless Dylan clearly means a new unrelated file. Never create a second case with the same case number just because the prior one was completed.',
    'When reopening a completed case, do not replace meaningful prior context with a generic sentence like “file reopened.” Reconstruct the new current_situation from the new update plus relevant historical facts. Prior completed steps remain historical facts; do not pretend they are undone unless Dylan says they were undone.',
    'If the latest sentence is brief or ambiguous, use the case history to resolve references and preserve established details. Do not let one short new statement erase names, property/file details, prior requests, or other useful context that still matters.',
    'If Dylan says it is a “different situation,” treat that as a new phase of the SAME case when the case number/context matches. Keep the old phase in the timeline, describe the new phase as current, and preserve any still-relevant facts from the earlier phase. Do not collapse the whole history into only the newest phrase.',
    'If the new situation cannot be determined from either the utterance or the file history, do not invent it. Make the uncertainty explicit in the confirmation_question so Dylan can correct it before saving.',
    'If the user is asking a question about existing Work information, return kind=answer, a direct answer, and an empty proposals array. Questions include “where are we on this?”, “what needs me right now?”, “what am I waiting on?”, and requests to brief or summarize a file.',
    'If the user reports work that should change records, return kind=changes and one proposal per distinct file or standalone work matter. A single ramble can update multiple files.',
    'Case numbers use canonical GYY-NNNN format. Input has already been normalized when the digits were clear. Never invent or alter a digit. If a case number remains unclear, phrase the confirmation_question around the uncertainty rather than guessing a new number.',
    'Match an existing case whenever the case number or context clearly identifies it. For an existing case copy its case_id and exact updated_at into expected_updated_at. For a genuinely new case set both to null. Do not create a duplicate case just because the wording changed.',
    'For updates, output the COMPLETE desired case state. Preserve every existing field that the user did not change, including title, case number, closing date, and follow-up. Null means the final value should be empty, not “unchanged.”',
    'Workflow states: todo means Dylan has an action; waiting means Dylan already asked/sent/ordered something and the next move belongs to someone else; watching means no immediate action but the file needs monitoring; follow_up means Dylan’s next action is specifically to circle back later.',
    'Ball ownership: me means Dylan must act; other means another person or organization has the next move; watching means nobody has an immediate move and Dylan is monitoring; none is reserved for completed matters. Put the named person or organization in ball_with only when the user or existing record supports it.',
    'If Dylan is waiting on someone and gives a follow-up date, keep workflow_state=waiting and ball_owner=other. Store the follow-up date/time so it can resurface later.',
    'Do not invent clock times. A date without a time goes in follow_up_date. A date and explicit time goes in follow_up_at with the correct offset. Resolve relative dates from captured_at in the supplied IANA time zone.',
    'Closing dates are only stored when explicitly stated or already present on the existing case. Never infer a closing date from urgency.',
    'Completion: mark the whole case completed only when Dylan clearly says the file/matter itself is done, closed, finished, or no longer needs tracking. Finishing one step is an event, not case completion.',
    'Work-language cues: “need to call/text/email/order/upload/scan/send” usually means ball_owner=me and todo. “I texted/called/emailed/requested/ordered” usually means the request has been made and the ball moves to the recipient/result, so waiting is often appropriate. “payoff ordered”, “title search ordered”, or documents requested generally mean waiting for the result. “received”, “came in”, or “they sent it” means the waiting condition ended; use the user’s stated next action if present, otherwise describe what arrived and use the safest state without inventing a task. “good for now” or “just keep an eye on it” means watching.',
    'Use event_kind=request when Dylan made a request; response when something came back; action for Dylan’s completed step; follow_up when Dylan circled back; completion when the case closed; note/status for other factual changes. Reopening a completed file is usually event_kind=status unless the new statement itself is another action/request/response.',
    'The confirmation_question is what the wizard will show with Yes and No buttons. Make it concrete and complete enough that Dylan can see exactly where Orbit intends to put the information. For a reopened case, say that it is being reopened and include the new current situation/next action rather than only saying “reopen.”',
    'When information is uncertain but a safe draft can still be proposed, say the uncertainty in confirmation_question. A No answer will let Dylan correct it. Never hide uncertainty.',
    'For kind=answer, answer only from supplied cases/events. If the data does not contain the answer, say so. Do not turn a question into a task.',
    'Keep titles concise. Prefer the canonical case number at the beginning when present. current_situation says where the file stands now. next_action is the next concrete move, or an empty string when there is truly no known next action.',
    'commit_reply is a short sentence Orbit can speak after every proposal has been confirmed and saved.',
    'captured_at='+capturedAt+'; time_zone='+timeZone,
  ].join('\n');
}
