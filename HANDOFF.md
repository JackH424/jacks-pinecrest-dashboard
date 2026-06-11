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
- [ ] 1. **Priority levels** — UI for existing priority col (urgent/high/normal/low),
      selector on card+modal, sort, red URGENT accent. Action: setPriority.
- [ ] 2. **Recurring tasks** — col `repeat` text ('','daily','weekly','monthly');
      completing a repeating task spawns next instance w/ advanced due. Modal selector.
- [ ] 3. **"Hasn't moved" stale panel** — dashboard section listing open tasks with
      `updated_at` > 10 days, w/ project chip + days count (like Kayla's).
- [ ] 4. **Identity picker (login-lite)** — "Who are you?" dropdown of the 6, stored
      localStorage; replaces hardcoded primaryUser for "(me)", Messages, My Day,
      Telegram mapping. (Real Clerk auth = later A3, Jack deferred.)
- [ ] 5. **Unread state** — table comment_reads(person_id,comment_id,read_at);
      Messages tab badge = unread mentions for viewer; mark-read on open.
- [ ] 6. **Kanban board** — view grouping open tasks by status columns,
      HTML5 drag-drop between columns → setStatus.
- [ ] 7. **Subtask checklists** — table checklist_items(id,task_id,text,done,pos);
      editable list in task modal; card shows 2/5 progress.
- [ ] 8. **Task dependencies** — table task_deps(task_id,blocks_on);
      modal "blocked by" picker; auto-status Blocked while any dep open; show link.
- [ ] 9. **Calendar view** — month grid of tasks by due date (topbar Calendar tab).
- [ ] 10. **My Day** — personal view for viewer: overdue + due today/this week +
      urgent, sorted. Sidebar nav item.
- [ ] 11. **Workload view** — per-person open counts by status/priority bars (People area).
- [ ] 12. **OTTER TRIAGE INBOX (high value!)** — pipe KB meeting action items into a
      review queue: table triage_items(id,title,context,source_title,source_date,
      source_url,assignee_guess,project_guess,status['pending'|'accepted'|'dismissed']).
      Ingest: cron `app/api/cron/triage/route.ts` reads brain repo via GitHub API
      (needs env `GITHUB_TOKEN` PAT w/ repo read on jacks-pinecrest-brain; ask Jack)
      → parse new transcripts' "## Action items" since last sync (track last file in
      _meta) → AI (OpenAI key, already set) routes project/assignee → triage rows.
      UI: "Triage" nav item w/ pending count; accept→create task / dismiss.
- [ ] 13. **Telegram notifications** — on @mention comment + daily due reminders,
      send Telegram DM. Needs Jack: create bot via @BotFather (token → env
      `TELEGRAM_BOT_TOKEN`); each member messages the bot once; store chat_ids in
      people table (col `telegram_chat_id`; tiny `/api/telegram/webhook` to capture).
- [ ] 14. **Weekly digest** — Monday-morning cron: per-person Telegram (or in-app
      message fallback): open/overdue/done-last-week/stale summary.

## Deferred / vetoed
- A3 real login (Clerk): recommended, Jack deferred — revisit before team rollout.
- Skip: Gantt, guest access, built-in chat channels, Motion-style auto-scheduling.
- Later: templates, decision log, KB↔task links, carrier pipeline view, role perms.

## KB repo backlog (separate from dashboard)
- Eli's real L1 files → drop in root, re-run compile (wikis are regenerable).
- Wiki dedupe/enrichment pass; steady-state compile automation for new transcripts.
- Gmail ingestion w/ spreadsheet approval gate (original Phase 5) — not started.

## CONTINUATION PROMPT (paste into a fresh Claude Code session)

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
