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

The source is supabase/functions/capture/index.ts with shared validation/processing in lib/capture-handler.ts and lib/capture-schema.ts. Deploy to project uouzmmexjundpfitogky using the checked-in Supabase configuration. OPENAI_API_KEY is read only from Edge Function Secrets. SUPABASE_URL and SUPABASE_ANON_KEY are supplied by Supabase. No service-role key is used by the function.

supabase/schema.sql records the existing deployed schema; do not rerun its CREATE TABLE statements over an existing installation. It enforces row ownership, owned parent relationships, atomic capture receipts, and completion of subtasks. Configure Auth's Site URL and allowed redirect URL to the live Pages URL above.

## Using it

Sign in or create an account and confirm its email. Tap the microphone, speak, then tap again to save. A typed thought follows the same flow. Captures save to IndexedDB before upload. A successful response is cached in the same transaction that removes its pending raw capture. Failure leaves the capture available for retry and playback. A server receipt prevents duplicate items after lost responses.

Home shows at most five relevant top-level active tasks or reminders. Areas holds the rest. Completing or reopening a parent also updates its subtasks. Editing details requires a connection; completion queues offline.

In iPhone Safari, use Share → Add to Home Screen. Open online once to cache the complete app shell. Pending work resumes while the app is open and connected. Keep Safari open until a recording is saved. This version has no push notifications or closed-app background processing. Device storage can be evicted by iOS; it is a recovery queue, not a backup.

## Verification

npm test checks Home selection, IndexedDB failure recovery and account isolation, protected capture processing with controlled provider responses, transcript reuse, and actual PostgreSQL RLS/transaction behavior using PGlite. These tests do not substitute for live Supabase or physical iPhone checks. See VERIFICATION.md for deployment and browser results.
