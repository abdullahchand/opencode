# Build API Reference

Base URL: `http://localhost:4096` (Build API) or `http://127.0.0.1:5050` (Webhook Server proxy)

OpenAPI spec: [`openapi.yaml`](./openapi.yaml)

---

## POST /api/build

Start a new build or continue an existing one.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | Yes | What to build or change |
| `webhook_url` | string (URL) | Yes | URL to receive result webhook |
| `job_id` | string | No | Existing job ID to continue (fix flow) |
| `directory` | string | No | Project directory. Auto-created as `build/<job_id>` if omitted |
| `skip_deploy` | boolean | No | Skip auto-deploy; preview only (default: `false`) |
| `options.deploy.netlify.site_id` | string | No | Reuse an existing Netlify site |
| `options.deploy.netlify.team_slug` | string | No | Netlify team (overrides env) |
| `options.deploy.netlify.deploy_dir` | string | No | Subdirectory to deploy (default: `dist`) |
| `options.agent` | string | No | Agent name |
| `options.model` | object | No | `{ providerID, modelID }` |

**Example:**

```bash
curl -X POST http://localhost:4096/api/build \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Build a barber shop landing page",
    "webhook_url": "http://127.0.0.1:5050/webhook",
    "skip_deploy": true
  }'
```

**Response: `202 Accepted`**

```json
{
  "job_id": "build_mmbmc5qa_b1y3rtn",
  "session_id": "session_01ABC...",
  "directory": "/path/to/build/build_mmbmc5qa_b1y3rtn",
  "status": "running",
  "message": "Build started; results will be sent to webhook."
}
```

**Errors:**

| Status | When |
|--------|------|
| `400` | Missing `prompt` or `repo_url` used (not yet supported) |
| `409` | Build already running for this `job_id` |

---

## GET /api/build/{job_id}

Get current status and result URLs for a build job.

**Example:**

```bash
curl http://localhost:4096/api/build/build_mmbmc5qa_b1y3rtn
```

**Response: `200 OK`**

```json
{
  "job_id": "build_mmbmc5qa_b1y3rtn",
  "session_id": "session_01ABC...",
  "directory": "/path/to/build/build_mmbmc5qa_b1y3rtn",
  "status": "completed",
  "preview_url": "http://localhost:4096/api/build/preview/build_mmbmc5qa_b1y3rtn",
  "live_url": "https://opencode-build-xxx.netlify.app",
  "claim_url": "https://app.netlify.com/claim?...",
  "error": null,
  "response": "Built a barber shop landing page with header, services, and CTA.",
  "updated_at": 1741234567890
}
```

**Status values:**

| Status | Meaning |
|--------|---------|
| `running` | AI agent is working |
| `completed` | Build finished successfully |
| `failed` | Build failed (see `error`) |

**Errors:** `404` if job not found.

---

## POST /api/build/{job_id}/send

Send a follow-up message to an existing build session. The agent has full context of all previous messages. No JSON instruction is prepended — the conversation is natural.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | Yes | Follow-up message |
| `webhook_url` | string (URL) | No | Override the webhook URL |

**Example:**

```bash
curl -X POST http://localhost:4096/api/build/build_mmbmc5qa_b1y3rtn/send \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Change the header to The Gentleman Cut and use a dark theme"
  }'
```

**Response: `202 Accepted`**

```json
{
  "job_id": "build_mmbmc5qa_b1y3rtn",
  "session_id": "session_01ABC...",
  "status": "running",
  "message": "Message sent; results will be sent to webhook."
}
```

**Errors:**

| Status | When |
|--------|------|
| `404` | Job not found |
| `409` | Session busy (previous message still processing) |

---

## POST /api/build/{job_id}/deploy

Deploy a completed build to Netlify.

Requires environment variables: `NETLIFY_PERSONAL_ACCESS_TOKEN` and `NETLIFY_TEAM_SLUG`.

On failure, the job's webhook is also notified with `deploy_error`.

**Example:**

```bash
curl -X POST http://localhost:4096/api/build/build_mmbmc5qa_b1y3rtn/deploy
```

**Response: `200 OK`**

```json
{
  "job_id": "build_mmbmc5qa_b1y3rtn",
  "live_url": "https://opencode-build-xxx.netlify.app",
  "claim_url": "https://app.netlify.com/claim?..."
}
```

**Errors:**

| Status | When |
|--------|------|
| `400` | Netlify not configured (missing env vars) |
| `404` | Job not found |
| `409` | Build still running |
| `500` | Deploy failed (error message in body) |

---

## GET /api/build/preview/{job_id}

Serves the built site directly from disk. This is what `preview_url` points to.

```bash
curl http://localhost:4096/api/build/preview/build_mmbmc5qa_b1y3rtn
# Returns the HTML page
```

Static assets are served at `/api/build/preview/{job_id}/{path}` (CSS, JS, images, etc.).

---

## Webhook Payload

When a build completes or fails, the Build API sends a POST to your `webhook_url`:

```json
{
  "job_id": "build_mmbmc5qa_b1y3rtn",
  "session_id": "session_01ABC...",
  "status": "completed",
  "preview_url": "http://localhost:4096/api/build/preview/build_mmbmc5qa_b1y3rtn",
  "live_url": "https://opencode-build-xxx.netlify.app",
  "claim_url": "https://app.netlify.com/claim?...",
  "error": null,
  "response": "Built a barber shop landing page with header, services, and CTA.",
  "timestamp": 1741234567890
}
```

When deploy fails, `deploy_error` is included:

```json
{
  "job_id": "build_mmbmc5qa_b1y3rtn",
  "status": "completed",
  "deploy_error": "Deploy failed: 401 {\"code\":401,\"message\":\"Access Denied\"}",
  "...": "..."
}
```

---

## Webhook Server Proxy (Flask)

The Flask webhook server at `http://127.0.0.1:5050` proxies all Build API calls and adds a web UI. It forwards requests to the Build API and receives webhooks.

| Method | Path | Proxies to | Description |
|--------|------|------------|-------------|
| POST | `/build` | `POST /api/build` | Start a build. Auto-creates `build/<job_id>` directory if none given. |
| GET | `/build/{job_id}` | `GET /api/build/{job_id}` | Get build status |
| POST | `/send/{job_id}` | `POST /api/build/{job_id}/send` | Send follow-up message |
| POST | `/deploy/{job_id}` | `POST /api/build/{job_id}/deploy` | Deploy to Netlify |
| POST | `/webhook` | — | Receives webhook callbacks; stores recent payloads |
| GET | `/webhooks` | — | List recent webhook payloads (JSON) |
| GET | `/` | — | Web form UI |
| GET | `/live` | — | Live preview page (iframe + prompt sidebar + deploy) |

**Proxy examples (same API, shorter paths):**

```bash
# Start build via proxy
curl -X POST http://127.0.0.1:5050/build \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Build a landing page", "skip_deploy": true}'

# Check status via proxy
curl http://127.0.0.1:5050/build/build_xxx

# Send follow-up via proxy
curl -X POST http://127.0.0.1:5050/send/build_xxx \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Add a contact section"}'

# Deploy via proxy
curl -X POST http://127.0.0.1:5050/deploy/build_xxx

# View webhook history
curl http://127.0.0.1:5050/webhooks
```

---

## Typical Flow

```
1. POST /api/build          → { job_id, status: "running" }
2. (agent works...)
3. Webhook fires             → { status: "completed", preview_url }
4. Open preview_url          → view site in browser
5. POST /api/build/{id}/send → { status: "running" }
6. (agent modifies...)
7. Webhook fires             → { status: "completed", preview_url }
8. Repeat 4-7 as needed
9. POST /api/build/{id}/deploy → { live_url, claim_url }
```

---

## Error Format

All errors return JSON:

```json
{
  "error": "Human-readable error message"
}
```
