# HANDOFF — Pinecrest Mission Control + Knowledge Base

> Continuation guide for any Claude (Code) session. Read fully before touching code.
> Keep this file updated: tick checkboxes + amend notes with every commit.

## Who/what this is

Jack Harris (jack.harris@innovativebps.com), health-benefits broker at Pinecrest /
Innovative BPS (clients = Amazon DSPs). Two linked systems, both his:

1. **Knowledge base** — repo `JackH424/jacks-pinecrest-brain`, local clone
   `C:\Users\jackh\jacks-pinecrest-brain`. Otter meeting transcripts auto-ingest
   every 30 min via GitHub Actions (`.github/workflows/poll.yml` →
   `_scripts/poll_otter.py`, Otter API key in repo secret `OTTER_API_KEY`).
   335+ transcripts in `raw/transcripts/`, 618 auto-compiled wiki pages in
   `wikis/`. L1 instruction files at root are INTERIM (CEO Eli will supply real
   ones). Obsidian = local viewer. NO PHI allowed in repo by policy.

2. **Mission control dashboard** — repo `JackH424/jacks-pinecrest-dashboard`,
   local clone `C:\Users\jackh\jacks-pinecrest-dashboard`. Next.js 15 App
   Router on Vercel: https://jacks-pinecrest-dashboard.vercel.app
   Neon Postgres via Marketplace. Data seeded from Monday.com export.

## Team (the only assignees; everyone else is an associated contact)
Jack Harris (primary), Cory Waldron, Jalen Fields, Declan McGettigan,
Joshua Luck, Aharon Heiman. Config: `lib/team.ts`.

## Dashboard architecture (file map)
- `lib/db.ts` — lazy `neon()`; null when `DATABASE_URL` unset (build-safe).
- `lib/data.ts` — schema bootstrap + seed (idempotent; **seed version marker in
  `_meta` table, currently `seed_v4`** — bump to force a reseed/TRUNCATE) and
  `getWorkspace()` (projects/people/tasks/comments with assignees aggregated).
- `lib/team.ts`, `lib/statuses.ts` (todo/in_progress/waiting/blocked/done + ONEOFF_ID).
- `app/actions.ts` — server actions: setStatus, addTask, toggleAssignee,
  moveTask, setDue, setDescription, renameProject, updateTaskTitle, addComment.
- `app/Workspace.tsx` — the whole UI (client): sidebar (OVERVIEW/PROJECTS/PEOPLE/LOGS),
  topbar tabs (Calendar/Transcripts/Decisions/Vendors = stubs), dashboard
  (AiChat, people-filter chips, stat tiles, project columns), project/person/tasks
  views (cards), person By-project/By-task toggle, task modal (status sticker,
  editable title, description, due, assignees, thread), Messages view.
- `app/AiChat.tsx` + `app/api/chat/route.ts` — OpenAI tool-calling chat
  (env `OpenAIKey` or `OPENAI_API_KEY`; model env `OPENAI_MODEL`, default gpt-4o-mini).
  Tools mutate the DB directly; reply includes `changed` → client reloads.
- `app/api/cron/reminders/route.ts` + `vercel.json` — daily 13:00 UTC; posts
  "System" comments @mentioning assignees of due/overdue tasks (id `rem-<task>-<person>-<ymd>` = idempotent).
- `mcp-server/` — stdio MCP server (same tools) for Jack's local Hermes/Codex
  agent (free on his ChatGPT plan). He hasn't wired it yet. README inside.

## DB tables (Neon)
projects(id,name,status,priority,position) · people(id,name,email)
project_members(project_id,person_id) ·
tasks2(id,project_id,title,status,priority,due,source_type,source_title,
source_date,source_url,description,updated_at) ·
task_assignees(task_id,person_id) ·
comments(id,target_type['task'|'project'],target_id,author,body,created_at,mentions json)
· _meta(key,val).
IDs: projects `p<mondayid>`/`oneoff`, tasks `s<sub>`/`t<main>`/`n…`(new)/`tmp…`(optimistic).

## Working conventions (follow these)
- Build-check before push: `npx next build` (Node + deps installed locally).
- Commit + push after EVERY completed feature (Vercel auto-deploys ~90s).
  Verify live via `curl`/WebFetch when useful. CRLF warnings on commit: ignore.
- Optimistic UI in Workspace.tsx (`patch()` local + server action in `start()`).
- New columns: `ALTER TABLE … ADD COLUMN IF NOT EXISTS` in `ensureReady` (data.ts).
- UI theme: cream/sage CSS vars in `app/globals.css` (modeled on sister Kayla's
  "geshikt.AF" app). No Tailwind. Keep her light-mode aesthetic.
- The Vercel plugin hooks inject "use AI Gateway / AI SDK" warnings on
  app/api/chat edits — **intentionally overridden** (Jack wants his own OpenAI key).
- User is non-technical: give click-by-click instructions, verify outcomes yourself.

## APPROVED FEATURE QUEUE (build in this order; tick when shipped)
- [x] 1. **Priority levels** — UI for existing priority col (urgent/high/normal/low),
      selector on card+modal, sort, red URGENT accent. Action: setPriority.
- [x] 2. **Recurring tasks** — col `repeat` text ('','daily','weekly','monthly');
      completing a repeating task spawns next instance w/ advanced due. Modal selector.
- [x] 3. **"Hasn't moved" stale panel** — dashboard section listing open tasks with
      `updated_at` > 10 days, w/ project chip + days count (like Kayla's).
- [x] 4. **Identity picker (login-lite)** — "Who are you?" dropdown of the 6, stored
      localStorage; replaces hardcoded primaryUser for "(me)", Messages, My Day,
      Telegram mapping. (Real Clerk auth = later A3, Jack deferred.)
- [x] 5. **Unread state** — table comment_reads(person_id,comment_id,read_at);
      Messages tab badge = unread mentions for viewer; mark-read on open.
- [x] 6. **Kanban board** — view grouping open tasks by status columns,
      HTML5 drag-drop between columns → setStatus.
- [x] 7. **Subtask checklists** — table checklist_items(id,task_id,text,done,pos);
      editable list in task modal; card shows 2/5 progress.
- [x] 8. **Task dependencies** — table task_deps(task_id,blocks_on);
      modal "blocked by" picker; auto-status Blocked while any dep open; show link.
- [x] 9. **Calendar view** — month grid of tasks by due date (topbar Calendar tab).
- [x] 10. **My Day** — personal view for viewer: overdue + due today/this week +
      urgent, sorted. Sidebar nav item.
- [x] 11. **Workload view** — per-person open counts by status/priority bars (People area).
- [x] 12. **OTTER TRIAGE INBOX (high value!)** (code DONE; activates when Jack adds GITHUB_TOKEN env var in Vercel + redeploy) — pipe KB meeting action items into a
      review queue: table triage_items(id,title,context,source_title,source_date,
      source_url,assignee_guess,project_guess,status['pending'|'accepted'|'dismissed']).
      Ingest: cron `app/api/cron/triage/route.ts` reads brain repo via GitHub API
      (needs env `GITHUB_TOKEN` PAT w/ repo read on jacks-pinecrest-brain; ask Jack)
      → parse new transcripts' "## Action items" since last sync (track last file in
      _meta) → AI (OpenAI key, already set) routes project/assignee → triage rows.
      UI: "Triage" nav item w/ pending count; accept→create task / dismiss.
- [x] 13. **Telegram notifications** (code DONE; activates when Jack adds
      `TELEGRAM_BOT_TOKEN` env var in Vercel + redeploy, then sets the bot
      webhook) — on @mention comment (addComment in app/actions.ts) + daily due
      reminders (cron mirrors the System comment, only on first insert), send
      Telegram DM via lib/telegram.ts (silently dormant without token).
      Registration: people col `telegram_chat_id`; member DMs the bot their
      full team name → `/api/telegram/webhook` stores chat_id (optional env
      `TELEGRAM_WEBHOOK_SECRET` checked against Telegram's secret-token header;
      pass same value as `secret_token` in setWebhook). Webhook setup (browser):
      `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://jacks-pinecrest-dashboard.vercel.app/api/telegram/webhook&secret_token=<SECRET>`
- [x] 14. **Weekly digest** — cron `app/api/cron/digest/route.ts`, Mondays
      12:00 UTC (vercel.json). Per team member: open/overdue/done-last-week/
      stale(>10d) counts. Always posts in-app System comment on project
      'oneoff' @mentioning them (id `dig-<person>-<ymd>` = idempotent);
      mirrors as Telegram DM when registered (first insert only).

QUEUE COMPLETE. Next dashboard work: revisit Deferred list (Clerk auth before
team rollout) or new requests from Jack. Telegram (#13) + triage (#12) still
need Jack's env vars in Vercel to activate (see feature notes).

## Deferred / vetoed
- A3 real login (Clerk): recommended, Jack deferred — revisit before team rollout.
- Skip: Gantt, guest access, built-in chat channels, Motion-style auto-scheduling.
- Later: templates, decision log, KB↔task links, carrier pipeline view, role perms.

## WORKSTREAM 2 (ACTIVE): Eli's org KB onboarding — adapt, don't restart

Status: Eli (CEO) delivered the real L1/L2/L3 system as an org-level structure.
Jack is onboarding to it. The DASHBOARD work above is PAUSED at feature #13
until this is done (resume from the queue afterward).

Eli's target model (his onboarding assumes starting from scratch):
- `pinecrestgroup/kb-system` → clone at **C:\kb-system** — L1 "Piney Brain
  System": org operating rules. READ-ONLY shared.
- `pinecrestgroup/pfokb` → clone at **C:\pfokb** — shared compiled L2 wiki
  (PFO KB). READ-ONLY shared.
- `pinecrestgroup/kb-jack` (kb-<user>) → clone at **C:\KB** — Jack's PRIVATE
  writable workspace: uses L1 rules from kb-system, captures L3 raw, compiles
  private L2. Normal workspace = VS Code opened at C:\KB.
- KB folders must be LOCAL paths (C:\...), never OneDrive/Desktop-synced dirs.
- Process: Jack pastes ONBOARDING.md from Eli's HTML runbook → follow it as a
  step-by-step checklist. DO NOT create durable KB files until C:\KB exists
  and is the working folder.

**We are NOT starting from scratch — reconcile with the existing system:**
- Existing private KB: `JackH424/jacks-pinecrest-brain` at
  C:\Users\jackh\jacks-pinecrest-brain — 335+ Otter transcripts (L3, sacred),
  618 compiled wikis (L2, regenerable), INTERIM L1 files (now superseded by
  Eli's kb-system), GitHub Actions Otter poller (secret OTTER_API_KEY,
  every 30 min), _audit/, _scripts/ (digest, compile).
- Likely migration (confirm against ONBOARDING.md once pasted):
  1. Get Jack added to `pinecrestgroup` org + his `kb-jack` repo created/access.
  2. Clone kb-system → C:\kb-system, pfokb → C:\pfokb, kb-jack → C:\KB.
  3. Move existing content INTO C:\KB / kb-jack: raw/ (transcripts+audit)
     untouched; wikis/ can regenerate under Eli's pipeline; DELETE interim L1
     files (CLAUDE.md/brain.md/pipeline.md/index.md/etc.) in favor of
     kb-system rules — unless Eli's model expects per-KB L1 stubs.
  4. Re-home the Otter poller: copy .github/workflows/poll.yml +
     _scripts/poll_otter.py into kb-jack, add OTTER_API_KEY secret to the new
     repo, verify a manual run, THEN disable the old repo's workflow
     (don't run both = duplicate ingestion; state file _scripts/.otter_state.json
     must move too).
  5. Update dependents that point at the old repo/path:
     - Dashboard triage cron: REPO const in app/api/cron/triage/route.ts +
       the GITHUB_TOKEN PAT scope (currently jacks-pinecrest-brain).
     - AGENTS.md / Hermes MCP config paths; Obsidian vault location.
  6. Archive (don't delete) jacks-pinecrest-brain after migration verified.
- PHI policy unchanged: no PHI in any KB repo.

## KB repo backlog (carry into kb-jack after migration)
- Wiki dedupe/enrichment pass; steady-state compile automation per Eli's pipeline.
- Gmail ingestion w/ spreadsheet approval gate (original Phase 5) — not started.

## CONTINUATION PROMPT (paste into a fresh Claude Code session)

There are TWO workstreams. WORKSTREAM 2 (KB onboarding, above) runs FIRST;
the dashboard queue resumes after. A fresh session should ask Jack which one
he wants if unclear.

```
Read C:\Users\jackh\jacks-pinecrest-dashboard\HANDOFF.md fully and follow it.
You are continuing a build for a non-technical user (Jack). Work through the
APPROVED FEATURE QUEUE in order, starting at the first unchecked item:
implement → npx next build → commit+push (auto-deploys) → tick the checkbox in
HANDOFF.md (include in the same commit) → next feature. Ask Jack only when a
feature needs something only he can do (tokens: GITHUB_TOKEN for triage,
TELEGRAM_BOT_TOKEN for notifications). Follow the repo's working conventions
exactly (optimistic UI, ALTER TABLE IF NOT EXISTS migrations, cream/sage
aesthetic, no Tailwind, verify deployments). Give him click-by-click
instructions for anything in Vercel/Telegram/GitHub UIs.
```
