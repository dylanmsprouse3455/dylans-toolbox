# Dylan’s Toolbox — first version

The product supports capture, conversational task corrections, automatic organization, attention, areas, and completion.

## Architecture and data flow

An iPhone-first React PWA records audio with MediaRecorder. It chooses an audio format supported by the browser, including MP4 on Safari. A typed capture follows the same path. The app saves the raw capture in IndexedDB before attempting a network request.

The protected Orbit /functions/v1/capture Edge Function validates the Supabase access token with Auth, transcribes the audio with OpenAI, and requests strict JSON output. It independently validates the response before saving it. Database writes run with the user's token, so RLS applies to the server as well as to browser requests. No service-role key is required. The frontend is a static GitHub Pages build and has no dependency on local Windows folders or a server running on the computer. OpenAI's key stays in the server environment.

The database lives in the separate Supabase project **Orbit**. The existing paused project is not used.

Captures retry on reconnection, app focus, and every minute while visible. Safari does not guarantee work while a PWA is closed: reopening the app resumes pending captures. Successful processing atomically caches returned items and deletes the local raw recording in one IndexedDB transaction. Failed recordings remain available for playback and retry. Task-completion changes also queue offline.

## Single-table schema

supabase/schema.sql documents the deployed schema. The items table contains id, user_id, type, title, content, area, status, importance, urgency, due_at, parent_id, source_text, created_at, updated_at and capture_id.

User-facing types are task, reminder, note, and reference. A fifth internal type, capture, is a processing receipt, never shown in the home or area lists. It lets an atomic transaction lock the capture and commit its items once, even if the same capture is retried or a successful response is lost. This avoids adding a separate queue table.

Parents and capture references include user_id in their foreign keys to prevent cross-account relationships. Subtasks are one level deep. Every operation requires an authenticated owner's row policy; updates check ownership both before and after the write.

## AI contract

The exact JSON Schema and runtime validator live in lib/capture-schema.ts.

    {"items":[{"type":"task|reminder|note|reference","title":"Short title",
      "content":"Preserved details","area":"Work|Home|Money|Personal|People|Projects|Ideas|Inbox",
      "importance":1,"urgency":1,"due_at":null,"subtasks":[]}]}

Scores are 1–5; 4–5 is high. Subtasks have the same fields except subtasks, and their type is task. The capture's original timestamp and IANA time zone anchor relative dates, including captures processed later. A date without a time uses due_date (YYYY-MM-DD), with due_at null. Explicit times use due_at and leave due_date null. No invented clock times, subtasks, or commitments.

The current contract extends the creation example above with due_date, updates, reply, and needs_clarification; lib/capture-schema.ts is authoritative. lib/conversation.ts retrieves bounded recent/search-matched items and recent turns using the caller's RLS-bound connection. The model may update only these IDs. Server-supplied expected_updated_at values prevent stale edits. Clarification responses cannot modify data.

supabase/conversation.sql adds toolbox_apply_turn. It locks the receipt and targets, validates versions, and atomically creates items, applies edits/completion, and records the assistant reply. Receipts store IDs and a reply instead of duplicated item snapshots. A retry returns current owned rows without reapplying operations. The local cache atomically merges created/updated rows and the reply before removing raw input, and rejects cross-owner or malformed update receipts. Newer cached versions and pending local status changes take precedence over old responses.

## Stored does not mean displayed

The default view includes only active top-level tasks or reminders that are important (4+), urgent (4+), or due within 72 hours. Rank = importance × 12 + urgency × 8 + due-date boost (overdue 80, next 24 hours 60, next 72 hours 35, next week 10). Ties use due date then creation time. Show at most five.

Areas reveal stored items only when opened, in pages of 25. Notes and references remain separate types and never appear in the attention list. Completing a parent completes its subtasks; reopening a parent reopens its subtasks.

## Practical boundaries

Reminders surface in the app; this version does not send push notifications or run scheduled background delivery. Voice recordings are limited to five minutes/20 MB. Keep the app open until a recording is saved. Leaving Safari mid-recording stops the recording and attempts to save it.

IndexedDB is a device queue and cache, not a backup. iOS can evict site storage. Confirm pending captures have synced before clearing browser data. Local caches are partitioned by authenticated user; signing out removes visible account state.

No watchers, external logins, PDF processing, analytics, chat, shared accounts, or autonomous follow-up systems.

## Implementation references

- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Auth](https://supabase.com/docs/guides/auth/passwords)
- [OpenAI structured output](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI transcription](https://developers.openai.com/api/docs/guides/speech-to-text)

## Work organized capture layer

The Work-specific path is:

`voice/type → immutable work_captures.raw_transcript → work_capture_versions.organized → existing case reasoning → existing wizard → confirmed case transaction`.

`work_captures` owns source text and its original time/zone. `work_capture_versions` stores immutable interpretations, verbatim corrections, citation provenance, relative-date wording and resolution, retry state, and the exact confirmed proposal. Each correction has its own idempotent receipt ID. `items` continues to hold Work preview/answer/commit receipts, so rule suggestions and the wizard retain their existing contracts. Discarded/superseded receipts no longer delete source evidence. The confirmation endpoint checks the revision shown and the existing case version checks remain in force.

The RLS-bound `work_capture_evidence` view exposes version/source labels and an indexed full-text search document. Work retrieval includes current cases, active/superseded facts, active/historical phases, timelines, organized captures and raw receipts. Structured current facts have precedence over older mentions. Organized claims include current/superseded/historical/uncertain status; current interpretation does not mean every claim was confirmed. Provenance pointers on case state, phase, fact and event records link confirmed changes to the organized version that produced them. Existing rows remain unchanged and can still be traced through their earlier receipt/event links.

Work's separate IndexedDB store contains only explicit text fields and original capture metadata. Audio is never written there or to a Supabase bucket. Transcription and organization use separate requests in the current client, allowing the audio references to be released before organization starts. The Edge Function also accepts the earlier combined preview request for compatibility and persists transcription before invoking organization. Errors return any successfully transcribed text, even if its server write failed, so the client can retain a recovery copy. Text-only retries use the same capture ID.

Regression coverage runs the real PostgreSQL schema with PGlite, plus the real Edge handler against a controlled provider/REST adapter. No test submits private case data to a live AI provider. Semantic paraphrase matching still relies on reasoning; explicit known event IDs and canonical fact/alias checks prevent replay of recognized duplicates, while receipt locks prevent duplicates on transport retries.
