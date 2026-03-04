"""
Flask server that uses the OpenCode Build API: start build → preview_url → modify → deploy.
Run: flask --app app run --port 5050
Then: open http://127.0.0.1:5050

All flows go through the Build API: POST /api/build, GET /api/build/:job_id, POST /api/build/:job_id/send (session message), POST /api/build/:job_id/deploy.
This server proxies those and receives webhooks; the live page can show the site via the API's preview_url.
"""
import json
import os
import random
import time
from collections import deque

from flask import Flask, request, jsonify, render_template_string, send_from_directory
from urllib.parse import urlencode
import requests

app = Flask(__name__)

BUILD_API_URL = os.environ.get("OPENCODE_BUILD_API", "http://localhost:4096")
WEBHOOK_BASE = os.environ.get("WEBHOOK_BASE", "http://127.0.0.1:5050")
RECENT_LIMIT = 50
CWD = os.getcwd()

recent_webhooks = deque(maxlen=RECENT_LIMIT)
last_webhook_by_job = {}


def _create_job_id():
    return f"build_{int(time.time() * 1000):x}_{random.randint(0, 36**6 - 1):06x}"


def _default_build_directory(job_id):
    return os.path.join(CWD, "build", job_id)


def _preview_root(directory=None, serve=None):
    base = (directory or "").strip() or CWD
    base = os.path.realpath(base)
    if not base.startswith(os.path.realpath(CWD)):
        return None
    if serve:
        root = os.path.join(base, (serve or "").strip().lstrip("/"))
    else:
        root = base
    root = os.path.realpath(root)
    if not root.startswith(os.path.realpath(CWD)):
        return None
    return root if os.path.isdir(root) else None


@app.route("/")
def index():
    return render_template_string(INDEX_HTML, build_api=BUILD_API_URL, webhook_base=WEBHOOK_BASE)


@app.route("/webhook", methods=["POST"])
def webhook():
    payload = request.get_json(force=True, silent=True) or {}
    recent_webhooks.append({"payload": payload, "headers": dict(request.headers)})
    job_id = payload.get("job_id")
    if job_id:
        last_webhook_by_job[job_id] = payload
    print("[webhook] received:", json.dumps(payload, indent=2))
    return jsonify({"ok": True})


@app.route("/webhooks")
def list_webhooks():
    return jsonify({"count": len(recent_webhooks), "webhooks": list(recent_webhooks)})


@app.route("/build/<job_id>")
def build_status(job_id):
    """Proxy GET Build API status (job_id, status, preview_url, live_url, claim_url, etc.)."""
    try:
        r = requests.get(f"{BUILD_API_URL}/api/build/{job_id}", timeout=10)
        return jsonify(r.json()), r.status_code
    except requests.RequestException as e:
        return jsonify({"error": str(e)}), 502


@app.route("/build", methods=["POST"])
def start_build():
    data = request.get_json(force=True, silent=True) or request.form
    input_job_id = (data.get("job_id") or "").strip()
    job_id = input_job_id or _create_job_id()
    directory = (data.get("directory") or "").strip() or _default_build_directory(job_id)
    prompt = (data.get("prompt") or "").strip()
    webhook_url = (data.get("webhook_url") or "").strip() or f"{WEBHOOK_BASE}/webhook"

    if not prompt:
        return jsonify({"error": "prompt is required"}), 400

    os.makedirs(directory, exist_ok=True)

    body = {
        "job_id": job_id,
        "directory": directory,
        "prompt": prompt,
        "webhook_url": webhook_url,
    }
    if data.get("skip_deploy"):
        body["skip_deploy"] = True

    try:
        r = requests.post(f"{BUILD_API_URL}/api/build", json=body, timeout=30)
        r.raise_for_status()
        return jsonify(r.json()), r.status_code
    except requests.RequestException as e:
        return jsonify({"error": str(e)}), 502


@app.route("/live")
def live():
    directory = request.args.get("directory", "").strip() or CWD
    serve = (request.args.get("serve") or "").strip()
    root = _preview_root(directory, serve if serve else None)
    if not root:
        return jsonify({"error": "Invalid directory or serve path (must be under server cwd)"}), 400
    site_query = urlencode({"directory": directory, "serve": serve})
    return render_template_string(
        LIVE_HTML,
        build_api=BUILD_API_URL,
        webhook_base=WEBHOOK_BASE,
        directory=directory,
        serve=serve,
        site_query=site_query,
    )


@app.route("/football-club")
def football_club():
    return send_from_directory(CWD, "football-club.html")


@app.route("/live/site/")
@app.route("/live/site/<path:path>")
def live_site(path=""):
    directory = (request.args.get("directory") or "").strip() or CWD
    serve = (request.args.get("serve") or "").strip()
    root = _preview_root(directory, serve if serve else None)
    if not root:
        return jsonify({"error": "Invalid directory or serve path"}), 400
    if path:
        full = os.path.join(root, path)
    else:
        full = root
    full = os.path.realpath(full)
    if not full.startswith(root):
        return jsonify({"error": "Invalid path"}), 400
    if os.path.isdir(full):
        index = os.path.join(full, "index.html")
        if os.path.isfile(index):
            return send_from_directory(full, "index.html")
        return jsonify({"error": "No index.html"}), 404
    if os.path.isfile(full):
        return send_from_directory(root, path)
    return jsonify({"error": "Not found"}), 404


@app.route("/deploy/<job_id>", methods=["POST"])
def deploy(job_id):
    try:
        r = requests.post(f"{BUILD_API_URL}/api/build/{job_id}/deploy", timeout=60)
        try:
            payload = r.json()
        except ValueError:
            payload = {"error": r.text or f"Upstream returned {r.status_code}"}
        return jsonify(payload), r.status_code
    except requests.RequestException as e:
        return jsonify({"error": str(e)}), 502


@app.route("/send/<job_id>", methods=["POST"])
def send_message(job_id):
    """Send a message to the build session (session-based). Body: { "prompt": "...", "webhook_url": "..." }."""
    data = request.get_json(force=True, silent=True) or {}
    prompt = (data.get("prompt") or "").strip()
    if not prompt:
        return jsonify({"error": "prompt is required"}), 400
    body = {"prompt": prompt}
    if data.get("webhook_url"):
        body["webhook_url"] = data["webhook_url"].strip()
    try:
        r = requests.post(f"{BUILD_API_URL}/api/build/{job_id}/send", json=body, timeout=30)
        try:
            payload = r.json()
        except ValueError:
            payload = {"error": r.text or f"Upstream returned {r.status_code}"}
        return jsonify(payload), r.status_code
    except requests.RequestException as e:
        return jsonify({"error": str(e)}), 502


INDEX_HTML = """
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Build API (OpenCode)</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.25rem; }
    h2 { font-size: 1rem; margin-top: 1.5rem; }
    label { display: block; margin-top: 0.75rem; font-weight: 500; }
    input, textarea { width: 100%; padding: 0.5rem; margin-top: 0.25rem; box-sizing: border-box; }
    textarea { min-height: 80px; }
    button { margin-top: 1rem; padding: 0.5rem 1rem; background: #333; color: #fff; border: none; cursor: pointer; }
    button:hover { background: #555; }
    .url { font-size: 0.875rem; color: #666; word-break: break-all; }
    pre { background: #f5f5f5; padding: 1rem; overflow: auto; font-size: 0.8rem; }
    .section { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #eee; }
    .link { color: #06c; }
    .link:hover { text-decoration: underline; }
    #result { margin-top: 1rem; }
    #result a { display: inline-block; margin-top: 0.5rem; }
    #sendResult { min-height: 1.5em; margin-top: 0.5rem; }
  </style>
</head>
<body>
  <h1>Build API (OpenCode)</h1>
  <p>Build API: <span class="url">{{ build_api }}</span></p>
  <p>Webhook: <span class="url">{{ webhook_base }}/webhook</span></p>
  <p><a href="/live" class="link">Live</a> — build, view via <code>preview_url</code>, modify, deploy.</p>

  <form method="post" action="/build" class="section" id="buildForm">
    <h2>Start build</h2>
    <label>Prompt (required)</label>
    <textarea name="prompt" placeholder="e.g. Build a simple landing page with a header and CTA" required></textarea>
    <label>Directory (optional — defaults to server cwd)</label>
    <input name="directory" type="text" placeholder="leave empty to use server's current directory" />
    <label><input type="checkbox" name="skip_deploy" value="1" checked /> Preview only (skip deploy until you call Deploy)</label>
    <input type="hidden" name="webhook_url" value="{{ webhook_base }}/webhook" />
    <label>Job ID (optional — leave empty for new build; set for modify)</label>
    <input name="job_id" type="text" placeholder="build_xxx" />
    <button type="submit">Start build</button>
  </form>
  <div id="result"></div>

  <div class="section">
    <h2>Build status (API)</h2>
    <p>GET <span class="url">/build/&lt;job_id&gt;</span> — returns <code>preview_url</code> (no trailing slash), <code>live_url</code>, <code>claim_url</code>, <code>status</code>, <code>response</code>.</p>
    <label>Job ID</label>
    <input type="text" id="statusJobId" placeholder="build_xxx" />
    <button type="button" id="fetchStatus">Fetch status</button>
    <pre id="statusOut"></pre>
  </div>

  <div class="section">
    <h2>Send message to session</h2>
    <p>After you have a job_id, send a follow-up to that session (conversational; no JSON instruction). POST <span class="url">/send/&lt;job_id&gt;</span>.</p>
    <label>Job ID</label>
    <input type="text" id="sendJobId" placeholder="build_xxx" />
    <label>Prompt</label>
    <textarea id="sendPrompt" placeholder="e.g. Change the site name to My Barber Shop" style="min-height: 60px;"></textarea>
    <button type="button" id="sendBtn">Send to session</button>
    <p class="msg" id="sendResult"></p>
  </div>

  <div class="section">
    <h2>Recent webhooks</h2>
    <p><a href="/webhooks" class="link">/webhooks</a> — last 50. Each payload has <code>job_id</code>, <code>preview_url</code> (no trailing slash), <code>live_url</code>, <code>claim_url</code>, <code>response</code>.</p>
  </div>

  <script>
    document.getElementById("buildForm")?.addEventListener("submit", async (e) => {
      if (e.submitter && e.submitter.type === "submit") {
        e.preventDefault();
        const form = e.target;
        const body = new FormData(form);
        const res = await fetch("/build", { method: "POST", body });
        const data = await res.json();
        const el = document.getElementById("result");
        if (!el) return;
        if (!res.ok) {
          el.innerHTML = "Error: " + (data.error || res.status);
          return;
        }
        el.innerHTML = "Build started. <strong>job_id</strong>: <code>" + data.job_id + "</code><br>" +
          '<a class="link" href="/build/' + data.job_id + '">View status (JSON)</a> · ' +
          '<a class="link" href="/live?job_id=' + encodeURIComponent(data.job_id) + '">Open live</a>';
        const statusJobId = document.getElementById("statusJobId");
        const sendJobId = document.getElementById("sendJobId");
        if (statusJobId) statusJobId.value = data.job_id || "";
        if (sendJobId) sendJobId.value = data.job_id || "";
      }
    });

    document.getElementById("fetchStatus")?.addEventListener("click", async () => {
      const id = document.getElementById("statusJobId")?.value?.trim();
      if (!id) return;
      const res = await fetch("/build/" + id);
      const data = await res.json();
      const out = document.getElementById("statusOut");
      if (out) out.textContent = JSON.stringify(data, null, 2);
    });

    document.getElementById("sendBtn")?.addEventListener("click", async () => {
      const id = (document.getElementById("sendJobId")?.value ?? "").trim();
      const prompt = (document.getElementById("sendPrompt")?.value ?? "").trim();
      const resultEl = document.getElementById("sendResult");
      if (!resultEl) return;
      if (!id || !prompt) {
        resultEl.textContent = !id && !prompt ? "Enter job ID and prompt." : (!id ? "Enter job ID." : "Enter prompt.");
        resultEl.style.color = "#c00";
        return;
      }
      resultEl.style.color = "";
      resultEl.textContent = "Sending…";
      try {
        const res = await fetch("/send/" + encodeURIComponent(id), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: prompt, webhook_url: "{{ webhook_base }}/webhook" })
        });
        let data;
        try {
          data = await res.json();
        } catch {
          resultEl.textContent = "Error: invalid response (" + res.status + ")";
          resultEl.style.color = "#c00";
          return;
        }
        if (!res.ok) {
          resultEl.textContent = "Error: " + (data.error || res.status);
          resultEl.style.color = "#c00";
          return;
        }
        resultEl.textContent = "Message sent. Session running; webhook will fire when done.";
        resultEl.style.color = "";
      } catch (err) {
        resultEl.textContent = "Error: " + (err && err.message ? err.message : String(err));
        resultEl.style.color = "#c00";
      }
    });
  </script>
</body>
</html>
"""

LIVE_HTML = """
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Live preview (Build API)</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; margin: 0; padding: 0; }
    .toolbar { padding: 0.75rem 1rem; background: #1a1a1a; color: #fff; display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
    .toolbar h1 { margin: 0; font-size: 1rem; font-weight: 600; }
    .toolbar input, .toolbar button { padding: 0.4rem 0.75rem; font-size: 0.875rem; }
    .toolbar .status { font-size: 0.8rem; color: #aaa; }
    .toolbar .deploy { margin-left: auto; }
    .toolbar .deploy button { background: #0a7; color: #fff; border: none; cursor: pointer; }
    .toolbar .deploy button:disabled { background: #555; cursor: not-allowed; }
    .preview { display: flex; height: calc(100vh - 52px); }
    .preview iframe { flex: 1; border: none; }
    .sidebar { width: 320px; padding: 1rem; background: #f5f5f5; overflow: auto; }
    .sidebar label { display: block; margin-top: 0.75rem; font-weight: 500; font-size: 0.875rem; }
    .sidebar textarea { width: 100%; min-height: 80px; padding: 0.5rem; margin-top: 0.25rem; font-size: 0.875rem; }
    .sidebar button { margin-top: 0.75rem; padding: 0.5rem 1rem; background: #333; color: #fff; border: none; cursor: pointer; font-size: 0.875rem; }
    .sidebar button:hover { background: #555; }
    .sidebar .msg { margin-top: 0.5rem; font-size: 0.8rem; color: #666; }
    .sidebar .url { word-break: break-all; font-size: 0.75rem; }
  </style>
</head>
<body>
  <div class="toolbar">
    <h1>Live (Build API)</h1>
    <span class="status" id="status">Modify with prompt · deploy when ready</span>
    <div class="deploy">
      <button type="button" id="deployBtn" disabled>Deploy to Netlify</button>
    </div>
  </div>
  <div class="preview">
    <iframe id="frame" title="Preview"></iframe>
    <div class="sidebar">
      <form id="modifyForm">
        <input type="hidden" name="directory" value="{{ directory }}">
        <input type="hidden" name="serve" value="{{ serve }}">
        <input type="hidden" name="webhook_url" value="{{ webhook_base }}/webhook">
        <input type="hidden" name="job_id" id="jobId" value="">
        <label for="prompt">Modify the site (session-based)</label>
        <textarea name="prompt" id="prompt" placeholder="e.g. Change the name to My Barber Shop" required></textarea>
        <button type="submit">Send to session</button>
      </form>
      <p class="msg" id="msg"></p>
      <p class="msg url" id="previewUrl"></p>
    </div>
  </div>
  <script>
    const form = document.getElementById("modifyForm");
    const jobIdEl = document.getElementById("jobId");
    const statusEl = document.getElementById("status");
    const msgEl = document.getElementById("msg");
    const previewUrlEl = document.getElementById("previewUrl");
    const deployBtn = document.getElementById("deployBtn");
    const frame = document.getElementById("frame");

    const params = new URLSearchParams(location.search);
    const urlJobId = params.get("job_id");
    const siteFallback = "/live/site/?{{ site_query }}";

    if (urlJobId) {
      jobIdEl.value = urlJobId;
      deployBtn.disabled = false;
      deployBtn.onclick = () => deploy(urlJobId);
      fetchPreviewUrl(urlJobId);
    } else {
      frame.src = siteFallback;
    }

    async function fetchPreviewUrl(jobId) {
      try {
        const r = await fetch("/build/" + jobId);
        const data = await r.json();
        if (data.preview_url) {
          frame.src = data.preview_url;
          previewUrlEl.textContent = "Preview: " + data.preview_url;
          statusEl.textContent = "Viewing via Build API preview_url";
        } else if (data.status === "running") {
          previewUrlEl.textContent = "Build running…";
          setTimeout(() => fetchPreviewUrl(jobId), 2000);
        } else {
          frame.src = siteFallback;
          previewUrlEl.textContent = "No preview_url yet; showing local serve.";
        }
      } catch {
        frame.src = siteFallback;
        previewUrlEl.textContent = "Using local serve.";
      }
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const jobId = jobIdEl.value.trim();
      const prompt = document.getElementById("prompt").value.trim();
      if (!prompt) return;
      msgEl.textContent = "Starting…";
      statusEl.textContent = "Build running…";
      try {
        if (jobId) {
          const r = await fetch("/send/" + jobId, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: prompt, webhook_url: "{{ webhook_base }}/webhook" })
          });
          const data = await r.json();
          if (!r.ok) {
            msgEl.textContent = "Error: " + (data.error || r.status);
            return;
          }
          msgEl.textContent = "Message sent to session. Waiting for result…";
          fetchPreviewUrl(jobId);
        } else {
          const body = new FormData(form);
          body.set("skip_deploy", "1");
          body.set("prompt", prompt);
          const r = await fetch("/build", { method: "POST", body });
          const data = await r.json();
          if (!r.ok) {
            msgEl.textContent = "Error: " + (data.error || r.status);
            return;
          }
          if (data.job_id) {
            jobIdEl.value = data.job_id;
            deployBtn.disabled = false;
            deployBtn.onclick = () => deploy(data.job_id);
            history.replaceState({}, "", "?job_id=" + data.job_id);
            fetchPreviewUrl(data.job_id);
          }
          msgEl.textContent = "Build started. Waiting for preview_url…";
        }
      } catch (err) {
        msgEl.textContent = "Error: " + err.message;
      }
    });

    async function deploy(id) {
      deployBtn.disabled = true;
      deployBtn.textContent = "Deploying…";
      try {
        const r = await fetch("/deploy/" + id, { method: "POST" });
        const data = await r.json();
        if (!r.ok) {
          msgEl.textContent = "Deploy failed: " + (data.error || r.status);
          deployBtn.disabled = false;
          deployBtn.textContent = "Deploy to Netlify";
          return;
        }
        msgEl.textContent = "Deployed: " + (data.live_url || "");
        if (data.claim_url) msgEl.innerHTML += ' <a target="_blank" href="' + data.claim_url + '">Claim site</a>';
        statusEl.textContent = "Deployed";
        deployBtn.textContent = "Deployed";
      } catch (err) {
        msgEl.textContent = "Error: " + err.message;
        deployBtn.disabled = false;
        deployBtn.textContent = "Deploy to Netlify";
      }
    }
  </script>
</body>
</html>
"""
