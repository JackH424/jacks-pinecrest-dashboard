# Pinecrest Mission Control — MCP server

Lets an MCP-capable agent (Hermes / Codex) read and modify mission control by
voice or text. It talks directly to the same Neon database the dashboard uses,
so anything the agent does shows up instantly in the web app.

## Tools exposed
- `list_projects`, `list_people`, `list_tasks`
- `create_task` (title, project, assignee, due, status, **description**)
- `set_status`, `set_due`, `assign_task`, `move_task`
- `update_task_details` (title / rich description)
- `add_comment` (supports `@Name` mentions → shows in that person's Messages)
- `create_project`

## Setup

### 1. Install
```
cd mcp-server
npm install
```

### 2. Get your database URL
Vercel → your `jacks-pinecrest-dashboard` project → **Storage** → the Neon
database → **.env.local** / connection string. Copy the `DATABASE_URL` value.

### 3. Add to your agent's MCP config
Point your agent (Hermes/Codex) at this server. Generic MCP config:

```json
{
  "mcpServers": {
    "pinecrest-mission-control": {
      "command": "node",
      "args": ["C:/Users/jackh/jacks-pinecrest-dashboard/mcp-server/index.mjs"],
      "env": { "DATABASE_URL": "paste-your-neon-connection-string-here" }
    }
  }
}
```

- **Codex CLI**: the equivalent goes in `~/.codex/config.toml` under
  `[mcp_servers.pinecrest-mission-control]` with `command`, `args`, and `env`.
- The path in `args` must be the absolute path to `index.mjs` on the machine
  running the agent.

### 4. Talk to it
Through Hermes (Telegram or terminal): *"In mission control, create a task in
WC Carrier Appointments: follow up with Ascot, assign Casey, due Friday."* The
agent calls the tools; the task appears in the dashboard.

## Notes
- This runs **locally** wherever your agent runs; it reaches the cloud Neon DB
  over the connection string. No per-token cost — the agent's reasoning runs on
  your ChatGPT/Codex plan.
- If Hermes/Codex doesn't load MCP servers this way, tell me what format it
  expects and I'll adapt (e.g., a REST API instead).
