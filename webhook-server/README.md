# Build API + Webhook server (Flask)

Flask app that **uses the OpenCode Build API**: it proxies `POST /build` → Build API, receives webhooks, and exposes **GET /build/<job_id>** for status (`preview_url`, `live_url`, `claim_url`). The live page shows the site via the API’s **preview_url** when available.

## Setup

```bash
cd webhook-server
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Run

1. Start the OpenCode server (in another terminal):

   ```bash
   bun run --cwd packages/opencode serve
   ```

2. Start this Flask app:

   ```bash
   flask --app app run --port 5050
   ```

3. Open http://127.0.0.1:5050 — start a build (preview only by default), then use **View status** or **Open live** to see `preview_url` and deploy when ready.

## APIs used

All flows go through the Build API:

- **POST /build** → `POST {{OPENCODE_BUILD_API}}/api/build` (prompt, optional job_id, skip_deploy). Use for the **first** message (new build). If `directory` is omitted, Flask auto-uses `webhook-server/build/<job_id>`.
- **POST /send/<job_id>** → `POST {{OPENCODE_BUILD_API}}/api/build/<job_id>/send` (prompt, optional webhook_url). **Session-based**: send a follow-up message to that session; no JSON instruction, full context.
- **GET /build/<job_id>** → `GET {{OPENCODE_BUILD_API}}/api/build/<job_id>` (returns status, preview_url with no trailing slash, live_url, claim_url, response).
- **POST /deploy/<job_id>** → `POST {{OPENCODE_BUILD_API}}/api/build/<job_id>/deploy` (returns live_url, claim_url). Uses the job’s existing webhook; on failure the webhook receives `deploy_error`.

Webhooks are sent to this server’s **POST /webhook**; each payload includes `job_id`, `preview_url` (no trailing slash), `live_url`, `claim_url`, `status`, `response`. When **deploy** is triggered (POST /deploy/<job_id>) and fails, the same webhook is called with `deploy_error` set to the failure message.

## Live page

**http://127.0.0.1:5050/live** (optional: `?serve=barber-landing` for a subdirectory):

1. **First message**: Type a prompt and click **Send to session** — calls **POST /build** with `skip_deploy: true`; you get `job_id`.
2. The page polls **GET /build/<job_id>**; when `preview_url` is set (no trailing slash), the iframe loads that URL.
3. **Follow-ups**: Once you have a job_id, later prompts use **POST /send/<job_id>** (session-based; agent has full context).
4. Click **Deploy to Netlify** — calls **POST /deploy/<job_id>**; you get `live_url` and `claim_url`.

## Endpoints

| Method | Path              | Description                                           |
|--------|-------------------|-------------------------------------------------------|
| GET    | /                 | Web form: start build + send message to session       |
| GET    | /live             | Live: build then send to session, view preview_url, deploy |
| GET    | /live/site/       | Static fallback when no preview_url yet              |
| GET    | /build/<job_id>   | Proxy: Build API status (preview_url, live_url, …)   |
| POST   | /build            | Proxy: start build (first message)                    |
| POST   | /send/<job_id>    | Proxy: send message to session (follow-ups)            |
| POST   | /deploy/<job_id>  | Proxy: deploy (Build API); uses job webhook; on failure webhook gets deploy_error |
| POST   | /webhook          | Receives build webhooks from OpenCode                |
| GET    | /webhooks         | JSON list of recent webhook payloads                 |

## Env (optional)

- `OPENCODE_BUILD_API` — Build API base URL (default: http://localhost:4096)
- `WEBHOOK_BASE` — Base URL for webhook link (default: http://127.0.0.1:5050)

## Curl examples

Start a build (preview only; webhook will POST to this server):

```bash
curl -X POST http://127.0.0.1:5050/build \
  -H "Content-Type: application/json" \
  -d '{"directory":"/abs/path/to/project","prompt":"Build a landing page.","webhook_url":"http://127.0.0.1:5050/webhook","skip_deploy":true}'
```

Get status (preview_url, live_url, claim_url):

```bash
curl http://127.0.0.1:5050/build/build_xxx
```

Deploy when ready:

```bash
curl -X POST http://127.0.0.1:5050/deploy/build_xxx
```

Send a message to the session (follow-up; session-based):

```bash
curl -X POST http://127.0.0.1:5050/send/build_xxx \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Change the site name to My Barber Shop","webhook_url":"http://127.0.0.1:5050/webhook"}'
```

View recent webhooks:

```bash
curl http://127.0.0.1:5050/webhooks
```
