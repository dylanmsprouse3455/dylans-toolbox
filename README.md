# Dylan’s Toolbox

An iPhone-friendly, voice-first personal toolbox. Stored does not mean displayed: Home shows at most five relevant tasks or reminders; notes and low-attention items stay in Areas.

## Architecture

- Static React frontend: GitHub Pages, https://dylanmsprouse3455.github.io/dylans-toolbox/
- Private authentication and database: the existing Supabase project **Orbit**.
- Protected AI capture: Orbit Edge Function **capture**, using the existing OPENAI_API_KEY secret.
- No Windows computer, local server, or local folder is needed after publication.
- Public project identifiers are in lib/public-config.ts. No private API keys belong in the browser or source repository.

## Development

Use Node 24 and npm. Run npm ci, npm test, and npm run build. Run npm run dev for local development or npm run preview for the production build. On the supplied Windows host, the optional scripts/windows-compat.mjs preload avoids Vite's mapped-drive probe restriction.

The Pages workflow builds and publishes main. TOOLBOX_BASE_PATH=/dylans-toolbox/ selects the hosted path. The original Sites build remains available as build:sites; Sites hosting is currently unavailable in this workspace.

## Backend

The source is supabase/functions/capture/index.ts with shared validation/processing in lib/capture-handler.ts, lib/capture-schema.ts, and lib/conversation.ts. Deploy to project uouzmmexjundpfitogky using the checked-in Supabase configuration. OPENAI_API_KEY is read only from Edge Function Secrets. SUPABASE_URL and SUPABASE_ANON_KEY are supplied by Supabase. No service-role key is used by the function.

supabase/schema.sql records the existing deployed schema; do not rerun its CREATE TABLE statements over an existing installation. It enforces row ownership, owned parent relationships, atomic capture receipts, and completion of subtasks. Configure Auth's Site URL and allowed redirect URL to the live Pages URL above.

After the base schema and owner-access setup, apply supabase/conversation.sql once before publishing the conversational backend and frontend. It adds day-only due dates and an atomic owner-only create/edit/complete transaction. This additive script was applied through the dashboard; do not run its ADD CONSTRAINT twice. The CLI was unavailable in this environment.

## Using it

Public signup is disabled. Only the account bound in the private database owner table can open the toolbox, access items, or use AI capture. The owner joins using an administrator-sent private invitation and sets a password. Signed-out visitors see only a sign-in screen. The owner's email and UUID are not published in source code. Apply supabase/owner-access.sql to an existing installation before deploying this version; an empty owner table denies all access until the administrator binds the invited account.

Open Talk, tap the microphone, speak, then tap again to save. The assistant describes what it actually created or changed, reads that reply aloud using the device's built-in voice, and shows the same reply in a compact corner chat bubble. A typed thought follows the same organization flow without unexpectedly speaking aloud. Captures save to IndexedDB before upload. A successful response is cached in the same transaction that removes its pending raw capture. Failure leaves the capture available for retry and playback. A server receipt prevents duplicate items after lost responses.

The microphone also updates existing tasks: "Move the catnip reminder to tomorrow at 3 p.m." or "I finished bringing catnip to work." The assistant shows a persistent reply and links to affected items. "Adjust that time" without a new time prompts a question; reply through the same microphone or text input. Opening an item and choosing Talk about this item explicitly targets it. A day such as tomorrow has no invented clock time. Clear multi-task completion reports can update several tasks while preserving new ideas from the same message.

Conversation context includes a bounded set of recent/search-matched owned items and recent messages. Missing or ambiguous matches should prompt clarification. AI proposals are validated, scoped to retrieved owned IDs, and checked against current row versions. Conflicting edits retain the message for retry. No conversational delete operation is supported. This is turn-by-turn recording with text replies, not a continuously open voice call.

Failed device saves retain separate in-memory captures with Download recording and Try saving again. Safari audio is stored as bytes and MIME type. Download before leaving a tab containing an unsaved recording.

Home shows at most five relevant top-level active tasks or reminders. Areas holds the rest. Completing or reopening a parent also updates its subtasks. Editing details requires a connection; completion queues offline.

In iPhone Safari, use Share → Add to Home Screen. Open online once to cache the complete app shell. Pending work resumes while the app is open and connected. Keep Safari open until a recording is saved. This version has no push notifications or closed-app background processing. Device storage can be evicted by iOS; it is a recovery queue, not a backup.

## Verification

npm test checks Home selection, IndexedDB failure recovery and account isolation, protected capture processing with controlled provider responses, transcript reuse, and actual PostgreSQL RLS/transaction behavior using PGlite. These tests do not substitute for live Supabase or physical iPhone checks. See VERIFICATION.md for deployment and browser results.

