# Pinecrest Mission Control

Custom task & follow-up dashboard for Pinecrest / Innovative BPS. Phase A1:
a Next.js app seeded with action items extracted from the knowledge base.

## Stack
- Next.js (App Router) on Vercel
- Phase A2: Neon Postgres (persistent tasks)
- Phase A3: Clerk (login + roles)

## Build phases
- **A1 (this):** task list UI seeded from `data/seed_tasks.json` (1,364 meeting action items). Status changes are local-only.
- **A2:** Neon Postgres — tasks persist, full add/edit/complete.
- **A3:** Clerk auth — login, then team roles.

## Local dev (optional)
```
npm install
npm run dev
```
Then open http://localhost:3000

## Deploy (the real path)
1. Create a private GitHub repo named `jacks-pinecrest-dashboard`.
2. Push this folder to it.
3. In Vercel: New Project → import the repo → Deploy (framework auto-detected).

## Data
`data/seed_tasks.json` is generated from the knowledge base. Regenerate by
re-running the extraction against `jacks-pinecrest-brain/_scripts/digest.json`.
Each task links back to its source meeting transcript on GitHub.
