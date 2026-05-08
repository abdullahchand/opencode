# Build API — AI-Powered Site Builder

An API layer on top of [OpenCode](https://github.com/anomalyco/opencode) that lets you build, preview, modify, and deploy websites through simple API calls. Tell it what to build, get a preview link, send follow-up messages to refine the site, and deploy to Netlify when ready.

## How it works

```
User prompt ──► Build API ──► OpenCode agent (AI) ──► Files on disk
                   │                                       │
                   │              ┌─────────────────────────┘
                   ▼              ▼
              preview_url    Netlify deploy
              (view site)    (live_url + claim_url)
                   │              │
                   └──────┬───────┘
                          ▼
                    Webhook callback
```

1. **You send a prompt** — "Build a barber shop landing page"
2. **The AI agent builds it** — creates HTML/CSS/JS files in an isolated directory
3. **You get a preview URL** — view the site in a browser without deploying
4. **You send follow-ups** — "Change the header to The Gentleman Cut" (same session, full context)
5. **You deploy** — one API call pushes to Netlify and returns a live URL

## Architecture

Two servers work together:

| Component | Tech | Port | Role |
|-----------|------|------|------|
| **Build API** | Bun + Hono (TypeScript) | 4096 | Core API. Creates sessions, runs the AI agent, serves previews, deploys to Netlify. |
| **Webhook Server** | Flask (Python) | 5050 | Lightweight proxy + UI. Provides a web form and live preview page. Receives webhooks. |

### Key files

```
packages/opencode/src/server/
├── routes/build.ts        # Build API routes (POST /api/build, GET /api/build/:id, etc.)
├── deploy-netlify.ts      # Netlify deploy logic (create site, zip, upload)
└── server.ts              # Mounts build routes at /api/build

webhook-server/
├── app.py                 # Flask proxy + web UI (index page, live page)
└── README.md              # Webhook server docs

docs/
└── build-api-design.md    # Original design document

.opencode/opencode.jsonc   # MCP server config (Netlify, Stitch)
.env.example               # Environment variable template
```

## What was built

### Build API (`packages/opencode/src/server/routes/build.ts`)

- **`POST /api/build`** — Start a new build or continue an existing one. Creates an OpenCode session, runs the AI agent with the user's prompt, and fires a webhook on completion. Returns `job_id` immediately (202).
- **`POST /api/build/:job_id/send`** — Send a follow-up message to an existing session. The agent has full context of all previous messages. No special JSON instruction is prepended (conversational).
- **`GET /api/build/:job_id`** — Poll job status. Returns `status`, `preview_url`, `live_url`, `claim_url`, `response`, `error`.
- **`GET /api/build/preview/:job_id`** — Serve the built site directly from disk (HTML, CSS, JS, images). This is what `preview_url` points to.
- **`POST /api/build/:job_id/deploy`** — Deploy to Netlify. Returns `live_url` and `claim_url`. Fires webhook on both success and failure.

### Session management

Each build job maps 1:1 to an OpenCode **session**:

- **First message**: A new session is created in the project directory. A special JSON instruction is prepended so the model returns structured output (`preview_url` + `response`).
- **Follow-up messages** (via `/send`): Reuse the same session. No instruction prepended — the agent sees full conversation history and responds naturally.
- **Jobs are in-memory**: The `jobs` map holds `job_id → { session_id, directory, status, ... }`. If the server restarts, jobs are lost.
- **Permissions**: Build sessions use `{ permission: "*", pattern: "*", action: "allow" }` so the agent can use any tool without waiting for human approval.

### Netlify deploy (`packages/opencode/src/server/deploy-netlify.ts`)

- Creates a new Netlify site (via API, named `opencode-<job_id>`)
- Zips the deploy directory and uploads it
- Returns `live_url` (the Netlify URL) and `claim_url` (optional, lets users claim the site)
- Deploy directory resolution: prefers directories containing `index.html` — checks `dist/`, `public/`, then root
- Structured error handling: returns `{ error: "..." }` instead of null on failure

### Webhook server (`webhook-server/app.py`)

- Proxies all Build API calls (so the UI only talks to Flask on port 5050)
- **Index page** (`/`): Form to start builds, check status, and send messages to sessions
- **Live page** (`/live?job_id=xxx`): Split view — iframe showing the preview + sidebar for sending prompts + deploy button
- Polls Build API for status (single polling loop, cancels previous on new request)
- **Auto-directory**: When no directory is specified, creates `webhook-server/build/<job_id>/` so each build is isolated
- Receives and stores webhook payloads for inspection

## Quick start

### Prerequisites

- [Bun](https://bun.sh/) (v1.3+)
- Python 3.8+ with pip
- `zip` command available in PATH

### 1. Environment

```bash
cp .env.example .env
# Edit .env — at minimum, set your AI provider credentials
# For Netlify deploy, also set:
#   NETLIFY_PERSONAL_ACCESS_TOKEN=...
#   NETLIFY_TEAM_SLUG=...
```

### 2. Start the Build API

```bash
bun run --cwd packages/opencode serve
# Runs on http://localhost:4096
```

### 3. Start the Webhook Server

```bash
cd webhook-server
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
flask --app app run --port 5050
# Open http://127.0.0.1:5050
```

## Usage

### Via the web UI

1. Open http://127.0.0.1:5050
2. Type a prompt (e.g. "Build a barber shop landing page") and click **Start build**
3. Click **Open live** to see the preview in an iframe
4. Type follow-up prompts in the sidebar (e.g. "Change the name to The Gentleman Cut")
5. Click **Deploy to Netlify** when ready

### Via API (curl)

```bash
# Start a build
curl -X POST http://127.0.0.1:5050/build \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Build a landing page","webhook_url":"http://127.0.0.1:5050/webhook","skip_deploy":true}'

# Check status
curl http://127.0.0.1:5050/build/<job_id>

# Send a follow-up message
curl -X POST http://127.0.0.1:5050/send/<job_id> \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Add a contact section"}'

# Deploy to Netlify
curl -X POST http://127.0.0.1:5050/deploy/<job_id>

# View webhook history
curl http://127.0.0.1:5050/webhooks
```

## Webhook payload

When a build completes (or fails), the Build API POSTs to your `webhook_url`:

```json
{
  "job_id": "build_xxx",
  "session_id": "session_xxx",
  "status": "completed",
  "preview_url": "http://localhost:4096/api/build/preview/build_xxx",
  "live_url": "https://xxx.netlify.app",
  "claim_url": "https://app.netlify.com/claim?...",
  "error": null,
  "response": "Built a barber shop landing page with header, services, and CTA.",
  "timestamp": 1234567890
}
```

When deploy fails, the webhook includes `deploy_error` with the failure message.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NETLIFY_PERSONAL_ACCESS_TOKEN` | For deploy | Netlify API token |
| `NETLIFY_TEAM_SLUG` | For deploy | Netlify team/account slug |
| `NETLIFY_OAUTH_CLIENT_ID` | No | For generating claim URLs |
| `NETLIFY_OAUTH_CLIENT_SECRET` | No | For generating claim URLs |
| `STITCH_API_KEY` | No | Google Stitch MCP key (for UI/UX generation) |
| `PREVIEW_BASE_URL` | No | Base URL for preview links (default: `http://localhost:4096`) |
| `OPENCODE_BUILD_API` | No | Build API URL for Flask (default: `http://localhost:4096`) |
| `WEBHOOK_BASE` | No | Webhook server URL (default: `http://127.0.0.1:5050`) |

## MCP servers

Configured in `.opencode/opencode.jsonc`:

- **Netlify MCP** (`@netlify/mcp`) — gives the AI agent direct access to Netlify tools
- **Stitch MCP** (`@_davideast/stitch-mcp`) — Google's UI/UX generation tools
