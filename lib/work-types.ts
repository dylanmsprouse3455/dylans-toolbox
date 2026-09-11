export type WorkState='todo'|'waiting'|'watching'|'follow_up';
export type BallOwner='me'|'other'|'watching'|'none';
export type WorkEventKind='request'|'response'|'action'|'status'|'note'|'follow_up'|'completion';
export type MatchConfidence='high'|'medium'|'low';
export type AnswerStatus='found'|'partial'|'historical_only'|'capture_only'|'missing_fact'|'not_seen';
export type WorkIntentHint='action'|'question'|'mixed'|'unclear';

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
  memory_summary:string;
  current_phase_id:string|null;
  follow_up_at:string|null;
  follow_up_date:string|null;
  follow_up_condition:string|null;
  follow_up_resolved_at:string|null;
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
  match_confidence:MatchConfidence|null;
  match_reason:string|null;
  occurred_at:string;
  created_at:string;
};

export type WorkCaseFact={
  id:string;
  user_id:string;
  case_id:string;
  fact_key:string;
  fact_value:string;
  normalized_value:string;
  aliases_text:string;
  confidence:MatchConfidence;
  source_capture_id:string|null;
  source_event_id:string|null;
  active:boolean;
  created_at:string;
  updated_at:string;
};

export type WorkCasePhase={
  id:string;
  user_id:string;
  case_id:string;
  phase_number:number;
  title:string;
  summary:string;
  status:'active'|'completed';
  started_at:string;
  ended_at:string|null;
  created_at:string;
  updated_at:string;
};

export type WorkRule={
  id:string;
  user_id:string;
  rule_key:string;
  rule_text:string;
  enabled:boolean;
  source_capture_id:string|null;
  created_at:string;
  updated_at:string;
};

export type FactChange={
  action:'upsert'|'remove';
  key:string;
  value:string;
  aliases:string[];
  confidence:MatchConfidence;
};

export type WorkRuleSuggestion={
  rule_key:string;
  rule_text:string;
  reason:string;
};

export type WorkProposal={
  duplicate_event_id?:string|null;
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
  memory_summary:string;
  follow_up_at:string|null;
  follow_up_date:string|null;
  follow_up_condition:string|null;
  closing_date:string|null;
  event_kind:WorkEventKind;
  event_summary:string;
  evidence_excerpt:string;
  match_confidence:MatchConfidence;
  match_reason:string;
  fact_changes:FactChange[];
  confirmation_question:string;
};

export type WorkPreview=
  | {kind:'changes';headline:string;answer:null;answer_status:null;commit_reply:string;proposals:WorkProposal[];rule_suggestions:WorkRuleSuggestion[]}
  | {kind:'answer';headline:string;answer:string;answer_status:AnswerStatus;commit_reply:string;proposals:[];rule_suggestions:WorkRuleSuggestion[]};

export type WorkPreviewReceipt={kind:'work_preview';turn_id:string;revision:number;preview:WorkPreview};
export type WorkCommitReceipt={kind:'work_commit';turn_id:string;case_ids:string[];cases:WorkCase[];reply:string};
