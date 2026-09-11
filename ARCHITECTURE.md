# Dylan’s Toolbox — first version

The product stays deliberately small: capture, automatic organization, attention, areas, and completion.

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

Scores are 1–5; 4–5 is high. Subtasks have the same fields except subtasks, and their type is task. The capture's original timestamp and IANA time zone anchor relative dates, including captures processed later. Explicit dates without a time use 9 a.m. local. Uncertain dates remain empty with their original wording in the details. No invented subtasks or commitments.

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
