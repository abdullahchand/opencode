# Build API design

API for “build something” flows: dev calls the API → system builds (with MCP) → returns preview link → optional deploy → live/claim links via webhook. Supports “fix” by reusing the same session (stateful). **All flows are API-only.**

## API-only flow

1. **User tells what to build** — `POST /api/build` with `prompt`, `webhook_url`, and optionally `skip_deploy: true` (recommended for preview-first). Response: `202` with `job_id`. When the build completes, the webhook receives `preview_url`: a URL on the same server to **view the site locally** (e.g. `http://localhost:4096/api/build/preview/<job_id>/`). No Netlify deploy yet.
2. **User modifies the site** — Same API: `POST /api/build` with the same `job_id` and a new `prompt` (and `skip_deploy: true`). Webhook again receives `preview_url`; open it to see changes.
3. **User asks to deploy** — `POST /api/build/:job_id/deploy`. Response: `live_url` and `claim_url`. Webhook is also notified with these fields.

So the client only uses: `POST /api/build`, `GET /api/build/:job_id`, `POST /api/build/:job_id/deploy`, and the webhook. No separate “live server” UI required; `preview_url` is the way to view the website before deploying.

## Prompt-based JSON response

## Session-based flow

Each job is one **session** (one OpenCode agent with full context). Use **`POST /api/build/:job_id/send`** with `{ "prompt": "..." }` to send a message to that session; no JSON instruction is prepended. Use **`POST /api/build`** with the same `job_id` for the same effect; the JSON instruction is only prepended on the first message of a new job. `preview_url` has no trailing slash.

## Prompt-based JSON response

Every **first** build prompt (new job) is automatically prefixed with an instruction so the model ends its final reply with a JSON block containing `preview_url` and `response`. Follow-up messages (same `job_id` or `/send`) do not get this instruction. The server injects the actual preview URL (no trailing slash) into the instruction. After the build completes, the server parses the last assistant message for a fenced ```json block and extracts `response`; that value is stored on the job and included in the webhook and `GET /api/build/:job_id` as `response` (a one-sentence summary from the model).

## Requirements (from user)

1. Dev calls the API to tell the system to build something.
2. System works automatically and builds.
3. Uses MCP automatically (e.g. Stitch MCP for UI/UX).
4. Deploys (e.g. Supabase + Netlify).
5. Returns the link via webhook.
6. User can call again to fix stuff → stateful (same project/session).

## Current codebase facts

- **Backend**: `packages/opencode` — Hono app in `src/server/server.ts`, Bun, default port 4096.
- **State**: Sessions are stateful (SQLite via Drizzle, keyed by `session.id`), scoped by `directory` and `project_id`. `Instance.provide({ directory })` scopes config (including MCP) to that directory.
- **Triggering work**: `POST /session` (create) + `POST /session/:sessionID/prompt_async` (fire-and-forget prompt). Sync alternative: `POST /session/:sessionID/message` (streaming).
- **MCP**: Loaded from config (`Config.get().mcp`) per instance; tools are resolved in `SessionPrompt.resolveTools` and used during the prompt loop. Project `opencode.json` / `.opencode/opencode.json` can define `mcp` (e.g. Stitch).
- **Events**: `GET /event` streams `BusEvent` (e.g. session updates). No built-in webhooks or job queue.

## Proposed API surface

### 1. Start a build (new or existing job)

```http
POST /api/build
Content-Type: application/json

{
  "job_id": "optional-existing-job-id",   // omit for new build; send for fix
  "directory": "/abs/path/to/project",    // OR "repo_url" for clone
  "repo_url": "https://github.com/org/repo",
  "prompt": "Build a small todo app with auth and deploy it.",
  "webhook_url": "https://your-app.com/webhook/opencode",
  "options": {
    "mcp_servers": ["stitch"],            // ensure these MCPs are available (by name)
    "deploy": {
      "netlify": { "site_id": "..." },
      "supabase": { "project_ref": "...", "db_password": "..." }
    },
    "agent": "default",
    "model": { "providerID": "...", "modelID": "..." }
  }
}
```

**Response (202 Accepted)**

```json
{
  "job_id": "build_01ABC...",
  "session_id": "session_01ABC...",
  "directory": "/path/to/workspace",
  "status": "running",
  "message": "Build started; results will be sent to webhook."
}
```

- If `job_id` is provided and exists, reuse that job’s session and directory (stateful “fix” flow); send the new prompt to the same session.
- If `repo_url` is provided (and no `directory`), clone into a temp workspace and use that as `directory`. Optional: persist workspace keyed by `job_id` for fixes.
- `directory` must be a path the server can read; typically a dedicated workspace dir or a cloned repo.

### 2. Get build status (optional)

```http
GET /api/build/:job_id
```

**Response**

```json
{
  "job_id": "...",
  "session_id": "...",
  "directory": "...",
  "status": "running" | "completed" | "failed",
  "preview_url": "http://localhost:4096/api/build/preview/<job_id>/",
  "live_url": "https://...",
  "claim_url": "https://...",
  "error": null,
  "updated_at": 1234567890
}
```

- `preview_url`: URL to view the built site (served by the same API). Present when the build has completed and a deploy directory (e.g. `dist/`, `public/`, or root with `index.html`) exists.
- `live_url` / `claim_url`: Set after a successful `POST /api/build/:job_id/deploy` (or if the initial build did not use `skip_deploy`).

### 3. Webhook payload (your server receives this)

When the build phase (and optionally deploy) finishes, the backend POSTs to `webhook_url`:

```json
{
  "job_id": "...",
  "session_id": "...",
  "status": "completed" | "failed",
  "preview_url": "http://localhost:4096/api/build/preview/<job_id>/",
  "live_url": "https://your-netlify-site.netlify.app",
  "claim_url": "https://app.netlify.com/claim?...",
  "deploy": {
    "netlify": { "url": "..." },
    "supabase": { "url": "...", "anon_key": "..." }
  },
  "error": null,
  "summary": "Optional short summary from session",
  "timestamp": 1234567890
}
```

On failure, `status: "failed"` and `error` set; `live_url` may still be from a previous successful deploy.

## Statefulness and “fix”

- One **job** ≈ one **session** (1:1 or N:1). Store `job_id → session_id` (and optionally `directory`) in a small store (e.g. SQLite table or in-memory with optional persist).
- **New build**: create session for that directory (or clone repo → directory → create session), register job_id, run prompt_async with build prompt.
- **Fix**: `POST /api/build` with same `job_id` (or with `session_id`). Look up session, send another prompt_async with the fix prompt. Same webhook when done.
- Session already keeps full history; the agent sees previous messages and can “fix” in place.

## MCP (e.g. Stitch)

- MCP is loaded from project config for the `directory` used for the build. So:
  - For **repo_url**: after clone, write an `opencode.json` (or `.opencode/opencode.json`) in the workspace that includes `mcp.stitch` (or whatever the Stitch server config is). Then `Instance.provide({ directory: workspacePath })` will load it and `SessionPrompt.resolveTools` will expose Stitch tools.
  - For **directory**: use that project’s existing `opencode.json`; ensure it has the right MCP (e.g. Stitch). No code change required if project already has it.
- Optional: API accepts `mcp_servers: ["stitch"]` and the backend ensures a minimal config for that workspace so those MCPs are present (injected into workspace config if missing).

## Deploy (Netlify + Supabase)

- **Option A – Agent does deploy**: Include in the build prompt: “When done, deploy frontend to Netlify and backend to Supabase using the provided credentials.” Expose Netlify/Supabase as tools or slash-commands that the agent can call (e.g. deploy tool that runs `netlify deploy`, Supabase migrations). Credentials can be passed via env or a small secrets store keyed by job_id.
- **Option B – Backend deploy step**: After the session’s “assistant” phase completes (no more tool calls / loop ended), a backend step runs: run `netlify deploy`, `supabase link` + push, etc. Config comes from `options.deploy` and/or from repo (e.g. `netlify.toml`).
- **Option C – Hybrid**: Agent produces a “deploy manifest” (e.g. “dist/” for Netlify, “supabase/migrations” for DB); backend step does the actual deploy using that manifest.

Recommendation: start with **Option B** (backend step) for predictable URLs and secrets handling; add agent-driven deploy later if needed.

## Implementation outline

1. **Routes**: New route group under `packages/opencode/src/server/routes/build.ts` (or `api/build.ts`), mounted at `/api/build` (or `/build`).
2. **Job store**: Small table or in-memory map: `job_id → { session_id, directory, webhook_url, status, live_url?, error?, deploy_config?, created_at, updated_at }`. Persist if you need jobs to survive server restart.
3. **Start build handler**:
   - Resolve `directory`: if `repo_url`, clone to temp dir and (optionally) write `opencode.json` with MCP; else use `directory`. If `job_id` given, load from job store and use existing `session_id` and `directory`.
   - Ensure instance: `Instance.provide({ directory, init, fn })` so config (and MCP) is correct.
   - Create session if new job: `Session.create({ directory, title: "Build: ..." })`.
   - Save job: `job_id → session_id, directory, webhook_url, deploy, status: "running"`.
   - Call `SessionPrompt.prompt({ sessionID, parts: [{ type: "text", text: prompt }], ... })` (or `prompt_async` for true fire-and-forget).
   - Return 202 with `job_id`, `session_id`, `directory`, `status: "running"`.
4. **Completion detection**: Subscribe to session lifecycle (e.g. Bus events for that session, or session status “idle” after “busy”) or poll `SessionStatus.list()` / last message. When “done”:
   - Run deploy step (Option B) if `options.deploy` is set.
   - Set `live_url` (and deploy details) in job store.
   - POST to `webhook_url` with payload above.
5. **GET /api/build/:job_id**: Read from job store and return status, `live_url`, `error`, etc.
6. **Fix flow**: Same `POST /api/build` with `job_id` (and new `prompt`). Look up session, call `SessionPrompt.prompt` again; completion + webhook logic unchanged.

## Security and operational notes

- **Auth**: Protect `/api/build` (e.g. API key header or same basic auth as rest of server). Validate `webhook_url` (allowlist or scheme/host checks).
- **Isolation**: Each build runs in one directory; use a dedicated workspace root and clean temp dirs for cloned repos to avoid cross-build leakage.
- **Secrets**: Don’t put Netlify/Supabase tokens in the request body in logs. Use env vars or a secrets store keyed by job or project.
- **Timeouts**: Set a max duration for the prompt loop (or per-session) so a stuck build eventually fails and triggers the webhook with `status: "failed"`.

## File changes (minimal scaffold)

- Add `packages/opencode/src/server/routes/build.ts`: route definitions, zod schemas, and stub handlers that:
  - Parse `POST /api/build` and `GET /api/build/:job_id`.
  - Implement job store (in-memory map for now).
  - Create session and call `SessionPrompt.prompt` (or `prompt_async`) in `Instance.provide` with the given directory.
- Mount in `server.ts`: `.route("/api/build", BuildRoutes())` (or `.route("/build", BuildRoutes())`).
- Completion + deploy + webhook can be added in the same file or a small `build/runner.ts` that subscribes to events and runs the deploy step and webhook POST.

This design uses the existing session and instance model so that MCP (including Stitch), agents, and tools behave as they do in the CLI/TUI, with a thin API and job layer on top.
