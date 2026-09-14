# ChatGPT → Dylan’s Toolbox anchor bridge

This bridge lets Dylan explicitly ask ChatGPT to save organized information into Dylan’s Toolbox without opening the Toolbox and copying it manually.

## User contract

Nothing is saved merely because it was discussed. A write should happen only after an explicit instruction such as:

- “Anchor that.”
- “Save this to Personal.”
- “Add this to Work.”
- “Put that on my Personal to-do list.”
- “Update G26-0232 with that.”

ChatGPT is the organizer; Dylan’s Toolbox remains the durable anchor.

## Personal

`toolbox_private.chatgpt_anchor_personal(...)` accepts one or more already-organized Personal items and commits them through the existing `toolbox_apply_turn` transaction.

The bridge refuses `area = Work`. Notes/references are normalized to non-actionable Personal records. Tasks/reminders may carry date-only or explicit-time due dates and the existing waiting/highlight fields.

## Work

`toolbox_private.chatgpt_anchor_work(...)` preserves the existing Work architecture instead of directly editing case rows:

`explicit ChatGPT save → immutable work capture → organized version → work preview → existing confirmation transaction → case/fact/event provenance`

When an exact `GYY-NNNN` case number is supplied, the bridge resolves that exact case, preserves fields that were not changed, creates the normal provenance records, and commits through `toolbox_confirm_work_capture` / `toolbox_apply_work_preview`.

When no case number is supplied, the text is retained as a searchable unlinked Work capture. It does not guess a file or mutate a case.

## Security

These functions live in the private `toolbox_private` schema and are executable only by the database `postgres` role. `PUBLIC`, `anon`, and `authenticated` have no execute permission. They are not an HTTP API and are not callable by the public GitHub Pages frontend.

The bridge temporarily establishes the existing single Toolbox owner as transaction-local `auth.uid()` only so it can reuse the same owner-scoped Toolbox database functions. No owner UUID, email address, service-role key, or other secret is committed to GitHub.

## Idempotency

Every ChatGPT anchor uses a UUID. Reusing the same UUID with the same source returns the prior result rather than duplicating the save. Reusing it with different source text is rejected.

## Operational note

The database migration is `supabase/chatgpt-anchor-bridge.sql`. The feature adds no new visible UI and does not change the GitHub Pages frontend. The connected Supabase admin tool is the intended ChatGPT-side transport.
