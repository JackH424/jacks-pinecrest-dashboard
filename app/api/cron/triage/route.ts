import { getSql } from "@/lib/db";
import { TEAM } from "@/lib/team";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Pulls new Otter transcripts from the knowledge-base repo (GitHub API),
// extracts their "## Action items", AI-routes each to a project/assignee,
// and queues them as pending triage items for human review.
const REPO = "JackH424/jacks-pinecrest-brain";
const GH = "https://api.github.com";
const MAX_FILES_PER_RUN = 8;

async function gh(path: string, token: string) {
  const r = await fetch(`${GH}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "pinecrest-mc" },
  });
  if (!r.ok) throw new Error(`GitHub ${path} -> ${r.status}`);
  return r.json();
}

function extractActionItems(md: string): string[] {
  const m = md.match(/^## Action items\s*$([\s\S]*?)(?=^## |\Z)/m);
  if (!m) return [];
  return m[1].split("\n")
    .filter((l) => l.trim().startsWith("- ["))
    .map((l) => l.replace(/^- \[[x ]\]\s*/, "").replace(/\s*@[\w .]+\s*(\(\w+\))?\s*$/, "").trim())
    .filter((t) => t.length > 5);
}

function fmTitle(md: string): string {
  const m = md.match(/^title:\s*"?(.+?)"?\s*$/m);
  return m ? m[1] : "";
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) return Response.json({ ok: false, error: "GITHUB_TOKEN not set — add a fine-grained PAT with read access to the brain repo in Vercel env vars." });
  const sql = getSql();
  if (!sql) return Response.json({ ok: false, error: "no database" });

  // All transcript files, sorted; date-prefixed names make lexicographic = chronological.
  const tree = await gh(`/repos/${REPO}/git/trees/main?recursive=1`, token) as { tree: { path: string; type: string }[] };
  const files = tree.tree
    .filter((n) => n.type === "blob" && /^raw\/transcripts\/\d{4}\/\d{2}\/.+\.md$/.test(n.path))
    .map((n) => n.path).sort();

  const last = ((await sql`SELECT val FROM _meta WHERE key='triage_last_file'`) as { val: string }[])[0]?.val || "";
  // First run: baseline to the newest existing transcript — only meetings from
  // now on get triaged (not the 335-file historical backlog).
  if (!last && files.length) {
    const newest = files[files.length - 1];
    await sql`INSERT INTO _meta (key,val) VALUES ('triage_last_file', ${newest}) ON CONFLICT (key) DO UPDATE SET val = ${newest}`;
    return Response.json({ ok: true, initialized: true, baseline: newest });
  }
  const todo = files.filter((f) => f > last).slice(0, MAX_FILES_PER_RUN);
  if (todo.length === 0) return Response.json({ ok: true, new_files: 0, queued: 0 });

  const projects = (await sql`SELECT id, name FROM projects`) as { id: string; name: string }[];
  const projNames = projects.map((p) => p.name).slice(0, 80);
  const openaiKey = process.env.OPENAI_API_KEY || process.env.OpenAIKey || process.env.OPENAIKEY;

  let queued = 0;
  for (const path of todo) {
    const blob = await gh(`/repos/${REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`, token) as { content: string };
    const md = Buffer.from(blob.content, "base64").toString("utf-8");
    const items = extractActionItems(md);
    const meeting = fmTitle(md) || path.split("/").pop()!.replace(".md", "");
    const date = (path.match(/(\d{4})\/(\d{2})\/(\d{4}-\d{2}-\d{2})/) || [])[3] || "";
    const url = `https://github.com/${REPO}/blob/main/${path}`;

    // AI routing (best-effort; falls back to blank guesses).
    let routes: { assignee?: string; project?: string }[] = items.map(() => ({}));
    if (openaiKey && items.length) {
      try {
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: process.env.OPENAI_MODEL || "gpt-4o-mini",
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: `Route meeting action items. Team: ${TEAM.join(", ")}. Projects: ${projNames.join("; ")}. Reply JSON {"routes":[{"assignee":"<team name or empty>","project":"<project name or empty>"}...]} — one entry per item, in order.` },
              { role: "user", content: `Meeting: ${meeting}\nItems:\n${items.map((t, i) => `${i + 1}. ${t}`).join("\n")}` },
            ],
          }),
        });
        const j = await r.json();
        const parsed = JSON.parse(j.choices?.[0]?.message?.content || "{}");
        if (Array.isArray(parsed.routes)) routes = parsed.routes;
      } catch { /* keep blank guesses */ }
    }

    for (let i = 0; i < items.length; i++) {
      const id = "tr-" + Buffer.from(`${path}#${i}`).toString("base64url").slice(0, 40);
      const a = TEAM.find((n) => n.toLowerCase() === (routes[i]?.assignee || "").toLowerCase()) || "";
      const pj = projects.find((p) => p.name.toLowerCase() === (routes[i]?.project || "").toLowerCase());
      const res = await sql`INSERT INTO triage_items (id,title,context,source_title,source_date,source_url,assignee_guess,project_guess)
        VALUES (${id},${items[i].slice(0, 300)},${""},${meeting},${date},${url},${a},${pj?.id || ""})
        ON CONFLICT (id) DO NOTHING RETURNING id`;
      if ((res as unknown[]).length) queued++;
    }
    await sql`INSERT INTO _meta (key,val) VALUES ('triage_last_file', ${path})
      ON CONFLICT (key) DO UPDATE SET val = ${path}`;
  }
  return Response.json({ ok: true, new_files: todo.length, queued });
}
