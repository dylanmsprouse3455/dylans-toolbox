# Dylan’s Toolbox — deployment handoff

## Conversational task updates
- Eighteen automated tests pass, including atomic task editing/completion, stale-version rollback, owner-only enforcement, idempotent retry, day-only dates, and durable local assistant replies.
- Isolated browser testing with controlled responses exercised: create a catnip task for tomorrow without a time; ask "adjust that time"; receive a clarification; answer "3 p.m."; update the same task; simulate a voice completion and remove it from Today.
- The live additive SQL update and capture function were deployed through the Supabase dashboard. A rolled-back production database check verified create, day-only storage, time correction, completion, retry, and denied anonymous execution without retaining test items.
- Actual OpenAI interpretation and physical iPhone recording for this new conversational flow still require an end-to-end user check. The browser scenario used simulated AI responses/audio.
- Owner-only signup/access restrictions and the recording download/retry fix remain in place. The older baseline verification below describes earlier deployment stages.

Live app: https://dylanmsprouse3455.github.io/dylans-toolbox/
Repository: https://github.com/dylanmsprouse3455/dylans-toolbox
Published app revision: 2a458733228f1311a89569fd8963456599264762
Successful deployment: https://github.com/dylanmsprouse3455/dylans-toolbox/actions/runs/34547695254

## Completed
- Published non-sensitive source to the approved public repository, preserving its initial commit.
- Deployed Orbit capture Edge Function at https://uouzmmexjundpfitogky.supabase.co/functions/v1/capture.
- Verified OPENAI_API_KEY exists in Orbit Edge Function Secrets; never retrieved, changed, or exposed its value.
- Function validates user tokens through Supabase Auth and uses the caller's token for database/RLS operations. No service-role key.
- Frontend calls Orbit directly. No Windows computer or local server is required.
- Fixed capture loss risk: cache the returned items and remove the raw pending capture in one IndexedDB transaction.
- Added owner/receipt response validation, owner filters during refresh, stale-refresh protection, and account-state cleanup.
- Retry reuses saved transcripts; processed receipt recovery works even without an available AI key.
- Corrected iPhone/audio filename handling; provider calls have bounded timeouts.
- Added versioned precaching of the complete static app shell and path-aware manifest, service worker, and auth redirects.
- Orbit Auth Site URL and its exact allowlisted redirect both point to the live Pages URL.

## Verified successfully
- Nine automated tests passed locally and in GitHub Actions.
- TypeScript and production build passed on GitHub's clean Linux runner.
- Actual PostgreSQL engine (PGlite) executed the schema and verified owner isolation, denied ownership reassignment, denied cross-owner references, anonymous denial, atomic duplicate prevention, editing, and parent/subtask completion.
- Controlled-provider capture tests cover auth rejection, CORS, text and audio flow, AI failure, transcript reuse, and already-saved retries.
- IndexedDB tests cover owner isolation, duplicate merging, wrong-owner/wrong-receipt rejection, transaction abort preserving audio, and queued completion overlays.
- Home tests cover five-item maximum, priority ordering, and exclusion of notes/references/backlog/completed/child items.
- Live Edge Function: OPTIONS 204 with CORS; unauthenticated POST 401.
- Live frontend: HTTP 200, rendered in browser, navigation and sign-in form checked, reload checked, 390 x 844 mobile layout inspected without horizontal overflow.
- Live versioned service worker and scoped PWA manifest both return HTTP 200.
- Orbit dashboard showed Healthy and no security advisor findings.
- Source scan found no private API keys, GitHub tokens, or private key material.

## Still unverified
- Successful live app sign-in/email confirmation and signed-in OpenAI text/voice capture.
- Real OpenAI key validity/billing: presence of the secret is confirmed, but a live signed-in request was not made.
- Live two-account RLS tests; the checked-in schema was tested in PostgreSQL, not by inspecting private production user data.
- Actual browser offline/network-loss recovery, installed PWA behavior, and physical iPhone Safari microphone/keyboard/safe-area behavior. Automated queue/receipt tests and mobile layout checks passed, but do not substitute for these device/end-to-end tests.

## Access and next steps
Supabase connector calls deny project permission, but Supabase browser access works via the existing GitHub sign-in. The Edge Function was deployed through the dashboard editor using the same processing/validation logic as the checked-in source. Its source is supabase/functions/capture/index.ts and lib/capture-handler.ts; no database migration was needed.

Automatic approval review blocked opening the private Auth users list, citing account-email exposure. Do not retry that user-list access without approval. This does not prevent the user from signing in to the app and testing capture.

The user can open the live app, sign in/create an account, and try a thought now. The user requested frequent updates, then asked to hurry/wrap up for a lower-tier agent. No separate task was created.

## Organized Work Captures — September 11, 2026

- Based on current GitHub main `8da5674c12d88d90f876b5b3e7f3f4efb608ed2d`; branch `feat/organized-work-captures`. No Personal modules, authentication settings, hosting, or existing case values changed.
- Full regression suite: 42 tests pass. Coverage includes exact raw text/line breaks, organized and unlinked retention, immutable correction versions, confirmation and stale-version boundaries, recognized paraphrase/fact/event duplicate prevention, provenance, RLS owner isolation, legacy migration, AI failure retry without retranscription, and text-only Work device/database storage.
- Production build with `TOOLBOX_BASE_PATH=/dylans-toolbox/` passes. Vite retains its existing bundle-size advisory; no unrelated splitting/refactor was introduced.
- PostgreSQL tests use PGlite and real migration/RPC execution. Handler integration uses controlled AI and REST responses backed by that database; no production case is created by testing.
- The cloud browser could not open the local preview (`ERR_BLOCKED_BY_CLIENT`), so browser interaction and physical iPhone microphone behavior were not verified in this environment.
- Before migration, Supabase security reported the existing leaked-password-protection warning. Performance reported only informational unused-index notices. Deployment/advisor results are recorded in the PR.
