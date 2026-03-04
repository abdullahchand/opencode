/**
 * Post-build Netlify deploy: create site, zip directory, upload, set live_url and claim_url.
 * Env: NETLIFY_PERSONAL_ACCESS_TOKEN, NETLIFY_TEAM_SLUG; optional: NETLIFY_OAUTH_CLIENT_ID, NETLIFY_OAUTH_CLIENT_SECRET for claim link.
 * See https://developers.netlify.com/guides/deploying-sites-from-ai-tools/
 */
import path from "path"
import fs from "fs/promises"
import { Log } from "../util/log"

const log = Log.create({ service: "server.build.deploy" })

const API = "https://api.netlify.com/api/v1"

export type NetlifyDeployConfig = {
  site_id?: string
  team_slug?: string
  deploy_dir?: string
}

export type NetlifyDeployResult = {
  live_url: string
  claim_url: string | null
}

export type NetlifyDeployError = { error: string }

/** Resolve the directory to serve for preview/deploy (dist, public, or directory with index.html). */
export async function getDeployDir(
  directory: string,
  config: { deploy_dir?: string } = {},
): Promise<string | null> {
  const deployDir = config.deploy_dir ?? "dist"
  let dir = deployDir === "." ? directory : path.join(directory, deployDir)
  try {
    await fs.access(dir)
    return dir
  } catch {
    const fallback = path.join(directory, "public")
    try {
      await fs.access(fallback)
      return fallback
    } catch {
      const rootIndex = path.join(directory, "index.html")
      try {
        await fs.access(rootIndex)
        return directory
      } catch {
        return null
      }
    }
  }
}

/** Result is either success or an error object (never null). */
export async function deployToNetlify(
  directory: string,
  jobId: string,
  config: NetlifyDeployConfig,
): Promise<NetlifyDeployResult | NetlifyDeployError> {
  const token = process.env.NETLIFY_PERSONAL_ACCESS_TOKEN
  if (!token) {
    log.warn("NETLIFY_PERSONAL_ACCESS_TOKEN not set; skipping Netlify deploy")
    return { error: "Netlify not configured: NETLIFY_PERSONAL_ACCESS_TOKEN not set" }
  }

  log.info("Netlify deploy starting", { job_id: jobId, directory })

  const dirToZip = await getDeployDir(directory, config)
  if (!dirToZip) {
    log.warn("no deploy dir found", { directory })
    return { error: "No deploy directory found (no dist, public, or index.html)" }
  }

  const zipPath = path.join(directory, `.netlify-deploy-${jobId}.zip`)
  try {
    const proc = Bun.spawn(["zip", "-r", "-q", zipPath, "."], {
      cwd: dirToZip,
      stdout: "ignore",
      stderr: "pipe",
    })
    const err = await new Response(proc.stderr).text()
    const exit = await proc.exited
    if (exit !== 0) {
      log.warn("zip failed", { exit, stderr: err })
      return { error: err || `Zip failed with exit ${exit}` }
    }
  } catch (e) {
    log.warn("zip command failed", { error: e })
    return { error: e instanceof Error ? e.message : "Zip command failed" }
  }

  let siteId = config.site_id
  const teamSlug = config.team_slug ?? process.env.NETLIFY_TEAM_SLUG
  if (!siteId && teamSlug) {
    const createRes = await fetch(`${API}/sites`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        account_slug: teamSlug,
        name: `opencode-${jobId}`,
        session_id: jobId,
        created_via: "opencode",
      }),
    })
    if (!createRes.ok) {
      const text = await createRes.text()
      log.error("Netlify create site failed", { status: createRes.status, body: text })
      return { error: `Netlify create site failed: ${createRes.status} ${text}` }
    }
    const site = (await createRes.json()) as { id: string }
    siteId = site.id
  }
  if (!siteId) {
    log.warn("no site_id and NETLIFY_TEAM_SLUG not set; skipping deploy")
    return { error: "Netlify not configured: set NETLIFY_TEAM_SLUG or pass site_id" }
  }

  const zipBuf = await fs.readFile(zipPath).finally(() => fs.unlink(zipPath).catch(() => {}))
  const deployRes = await fetch(`${API}/sites/${siteId}/deploys`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/zip",
    },
    body: zipBuf,
  })
  if (!deployRes.ok) {
    const text = await deployRes.text()
    log.error("Netlify deploy failed", { status: deployRes.status, body: text })
    return { error: `Deploy failed: ${deployRes.status} ${text}` }
  }

  const deploy = (await deployRes.json()) as {
    deploy_ssl_url?: string
    ssl_url?: string
    deploy_url?: string
    url?: string
  }
  const liveUrl =
    deploy.deploy_ssl_url ?? deploy.ssl_url ?? deploy.deploy_url ?? deploy.url ?? null
  if (!liveUrl) {
    log.warn("deploy response missing URL", { deploy: Object.keys(deploy) })
    return { error: "Deploy succeeded but response missing URL" }
  }

  const claimUrl = await buildClaimUrl(jobId)
  return { live_url: liveUrl, claim_url: claimUrl }
}

async function buildClaimUrl(sessionId: string): Promise<string | null> {
  const clientId = process.env.NETLIFY_OAUTH_CLIENT_ID
  const secret = process.env.NETLIFY_OAUTH_CLIENT_SECRET
  if (!clientId || !secret) return null

  const header = { alg: "HS256", typ: "JWT" }
  const payload = {
    client_id: clientId,
    session_id: sessionId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
  }
  const b64 = (data: string) => Buffer.from(data).toString("base64url")
  const unsigned = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(payload))}`
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(unsigned))
  const token = `${unsigned}.${Buffer.from(sig).toString("base64url")}`
  const toolName = process.env.NETLIFY_CLAIM_UTM_SOURCE ?? "opencode"
  return `https://app.netlify.com/claim?utm_source=${toolName}#${token}`
}
