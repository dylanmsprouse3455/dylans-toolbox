export type WorkState='todo'|'waiting'|'watching'|'follow_up';
export type BallOwner='me'|'other'|'watching'|'none';
export type WorkEventKind='request'|'response'|'action'|'status'|'note'|'follow_up'|'completion';

export type WorkCase={
  id:string;
  user_id:string;
  case_number:string|null;
  title:string;
  status:'active'|'completed';
  workflow_state:WorkState;
  ball_owner:BallOwner;
  ball_with:string|null;
  current_situation:string;
  next_action:string;
  follow_up_at:string|null;
  follow_up_date:string|null;
  closing_date:string|null;
  last_event_at:string;
  created_at:string;
  updated_at:string;
};

export type WorkEvent={
  id:string;
  user_id:string;
  case_id:string;
  capture_id:string|null;
  kind:WorkEventKind;
  summary:string;
  source_text:string;
  occurred_at:string;
  created_at:string;
};

export type WorkProposal={
  case_id:string|null;
  expected_updated_at:string|null;
  case_number:string|null;
  title:string;
  status:'active'|'completed';
  workflow_state:WorkState;
  ball_owner:BallOwner;
  ball_with:string|null;
  current_situation:string;
  next_action:string;
  follow_up_at:string|null;
  follow_up_date:string|null;
  closing_date:string|null;
  event_kind:WorkEventKind;
  event_summary:string;
  confirmation_question:string;
};

export type WorkPreview=
  | {kind:'changes';headline:string;answer:null;commit_reply:string;proposals:WorkProposal[]}
  | {kind:'answer';headline:string;answer:string;commit_reply:string;proposals:[]};

export type WorkPreviewReceipt={kind:'work_preview';turn_id:string;revision:number;preview:WorkPreview};
export type WorkCommitReceipt={kind:'work_commit';turn_id:string;case_ids:string[];cases:WorkCase[];reply:string};
