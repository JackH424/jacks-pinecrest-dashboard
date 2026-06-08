import seed from "@/data/seed_tasks.json";

export type Task = {
  id: string;
  title: string;
  assignee: string;
  status: "todo" | "doing" | "done";
  priority: "low" | "normal" | "high";
  due: string;
  source_type: string;
  source_title: string;
  source_date: string;
  source_url: string;
};

// A1: tasks come from the seed file extracted from the knowledge base.
// A2 will replace this with a Neon Postgres query.
export function getTasks(): Task[] {
  return (seed as Task[]).slice().sort((a, b) =>
    (b.source_date || "").localeCompare(a.source_date || "")
  );
}

export const PRIMARY_USER = "Jack Harris";
