/**
 * Build API: start build jobs, optional deploy, webhook on completion.
 * Design: docs/build-api-design.md
 * API-only flow: build → preview_url to view locally → modify (same job_id) → deploy when ready.
 */
import path from "path"
import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Instance } from "../../project/instance"
import { Session } from "../../session"
import { SessionPrompt } from "../../session/prompt"
import { Log } from "../../util/log"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { PermissionNext } from "../../permission/next"
import { deployToNetlify, getDeployDir } from "../deploy-netlify"

const log = Log.create({ service: "server.build" })

// Allow all tool use in headless build sessions so the agent doesn't wait for permission (no one to reply).
const BUILD_PERMISSION: PermissionNext.Ruleset = [
  { permission: "*", pattern: "*", action: "allow" },
]

const DeployNetlify = z.object({
  site_id: z.string().optional(),
  team_slug: z.string().optional(),
  deploy_dir: z.string().optional(),
})
const DeploySupabase = z.object({
  project_ref: z.string(),
  db_password: z.string().optional(),
})
const BuildOptions = z.object({
  mcp_servers: z.array(z.string()).optional(),
  deploy: z
    .object({
      netlify: DeployNetlify.optional(),
      supabase: DeploySupabase.optional(),
    })
    .optional(),
  agent: z.string().optional(),
  model: z.object({ providerID: z.string(), modelID: z.string() }).optional(),
})

const BuildStartSchema = z.object({
  job_id: z.string().optional(),
  directory: z.string().optional(),
  repo_url: z.string().url().optional(),
  prompt: z.string(),
  webhook_url: z.string().url(),
  options: BuildOptions.optional(),
  skip_deploy: z.boolean().optional(),
})

type JobEntry = {
  job_id: string
  session_id: string
  directory: string
  webhook_url: string
  status: "running" | "completed" | "failed"
  preview_url: string | null
  live_url: string | null
  claim_url: string | null
  error: string | null
  response: string | null
  deploy_config: z.infer<typeof BuildOptions>["deploy"] | null
  skip_deploy: boolean
  created_at: number
  updated_at: number
}

const jobs = new Map<string, JobEntry>()

/** Instruction prepended only on the first message of a new session so the model returns JSON with preview_url and response. */
const BUILD_RESPONSE_INSTRUCTION = (previewUrl: string) =>
  `[Build API: When you finish this request, end your final response with a JSON code block (fenced by \`\`\`json and \`\`\`) containing exactly: {"preview_url": "${previewUrl}", "response": "one sentence summary of what you built or changed"}. Use the exact preview_url above.]\n\n`

type PromptPayload = Pick<z.infer<typeof BuildStartSchema>, "prompt" | "options"> & {
  sessionID: string
  prependInstruction?: boolean
}

async function runBuild(directory: string, jobId: string, body: PromptPayload) {
  const previewBase = (process.env.PREVIEW_BASE_URL || "http://localhost:4096").replace(/\/$/, "")
  const previewUrl = `${previewBase}/api/build/preview/${jobId}`
  const text =
    body.prependInstruction !== false ? BUILD_RESPONSE_INSTRUCTION(previewUrl) + body.prompt : body.prompt
  const payload = {
    sessionID: body.sessionID,
    parts: [{ type: "text" as const, text }],
    agent: body.options?.agent,
    model: body.options?.model,
  }
  await Instance.provide({
    directory,
    fn: async () => {
      try {
        log.info("build running", { job_id: jobId })
        await SessionPrompt.prompt(payload as Parameters<typeof SessionPrompt.prompt>[0])
        const job = jobs.get(jobId)
        if (job) {
          job.status = "completed"
          job.updated_at = Date.now()
          const parsed = await parseBuildResponseFromSession(body.sessionID)
          if (parsed?.response) job.response = parsed.response
          const netlifyConfig = job.deploy_config?.netlify ?? {}
          const canDeploy =
            process.env.NETLIFY_PERSONAL_ACCESS_TOKEN &&
            (netlifyConfig.site_id ?? process.env.NETLIFY_TEAM_SLUG)
          if (canDeploy && !job.skip_deploy) {
            const result = await deployToNetlify(job.directory, jobId, {
              site_id: netlifyConfig.site_id,
              team_slug: netlifyConfig.team_slug,
              deploy_dir: netlifyConfig.deploy_dir,
            })
            if (result && !("error" in result)) {
              job.live_url = result.live_url
              job.claim_url = result.claim_url
            }
          } else if (canDeploy && job.skip_deploy) {
            log.info("Netlify deploy skipped: skip_deploy=true (preview mode)", { job_id: jobId })
          } else if (!process.env.NETLIFY_PERSONAL_ACCESS_TOKEN) {
            log.info("Netlify deploy skipped: set NETLIFY_PERSONAL_ACCESS_TOKEN and NETLIFY_TEAM_SLUG (or options.deploy.netlify) for live_url", {
              job_id: jobId,
            })
          } else {
            log.info("Netlify deploy skipped: set NETLIFY_TEAM_SLUG or pass options.deploy.netlify.site_id", {
              job_id: jobId,
            })
          }
          const previewBase = (process.env.PREVIEW_BASE_URL || "http://localhost:4096").replace(/\/$/, "")
          const deployDir = await getDeployDir(job.directory, {
            deploy_dir: job.deploy_config?.netlify?.deploy_dir,
          })
          if (deployDir) {
            job.preview_url = `${previewBase}/api/build/preview/${jobId}`
          }
          log.info("build completed", { job_id: jobId, preview_url: job.preview_url, live_url: job.live_url })
          await notifyWebhook(job)
        }
      } catch (err) {
        const job = jobs.get(jobId)
        if (job) {
          job.status = "failed"
          job.error = err instanceof Error ? err.message : String(err)
          job.updated_at = Date.now()
          log.error("build failed", { job_id: jobId, error: err })
          await notifyWebhook(job)
        }
      }
    },
  })
}

async function notifyWebhook(job: JobEntry, opts?: { deploy_error?: string }) {
  try {
    const payload: Record<string, unknown> = {
      job_id: job.job_id,
      session_id: job.session_id,
      status: job.status,
      preview_url: job.preview_url,
      live_url: job.live_url,
      claim_url: job.claim_url,
      error: job.error,
      response: job.response,
      timestamp: job.updated_at,
    }
    if (opts?.deploy_error != null) payload.deploy_error = opts.deploy_error
    await fetch(job.webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  } catch (e) {
    log.error("webhook failed", { job_id: job.job_id, error: e })
  }
}

function createJobId() {
  return "build_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9)
}

/** Parse the last assistant message for a ```json block with preview_url and response (from build instruction). */
async function parseBuildResponseFromSession(sessionID: string): Promise<{ response: string } | null> {
  const msgs = await Session.messages({ sessionID })
  const lastAssistant = msgs.find((m) => m.info.role === "assistant")
  if (!lastAssistant) return null
  const text = lastAssistant.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text)
    .join("")
  const match = text.match(/```json\s*([\s\S]*?)```/)
  if (!match) return null
  try {
    const obj = JSON.parse(match[1].trim()) as { response?: string }
    return obj?.response != null ? { response: String(obj.response) } : null
  } catch {
    return null
  }
}

export const BuildRoutes = lazy(() =>
  new Hono()
    .post(
      "/",
      describeRoute({
        summary: "Start or continue a build",
        description:
          "Start a new build (or fix an existing one). System builds in the given directory (or cloned repo), uses MCP, optionally deploys, and sends the result to the webhook.",
        operationId: "build.start",
        responses: {
          202: {
            description: "Build started",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    job_id: z.string(),
                    session_id: z.string(),
                    directory: z.string(),
                    status: z.enum(["running"]),
                    message: z.string(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("json", BuildStartSchema),
      async (c) => {
        const body = c.req.valid("json")
        let directory: string
        let sessionId: string
        let jobId: string
        const isContinuation = !!(body.job_id && jobs.has(body.job_id))

        if (body.job_id && jobs.has(body.job_id)) {
          const job = jobs.get(body.job_id)!
          if (job.status !== "running") {
            directory = job.directory
            sessionId = job.session_id
            jobId = job.job_id
            job.status = "running"
            job.updated_at = Date.now()
          } else {
            return c.json({ error: "Build already running for this job" }, 409)
          }
        } else {
          if (body.repo_url) {
            // TODO: clone repo into temp dir; for now require directory
            log.warn("repo_url not implemented yet; use directory")
            return c.json({ error: "repo_url not yet supported; pass directory" }, 400)
          }
          directory = body.directory ?? process.cwd()
          jobId = body.job_id ?? createJobId()

          const session = await Instance.provide({
            directory,
            fn: async () =>
              Session.create({
                title: `Build ${jobId}`,
                permission: BUILD_PERMISSION,
              }),
          })
          sessionId = session.id

          jobs.set(jobId, {
            job_id: jobId,
            session_id: sessionId,
            directory,
            webhook_url: body.webhook_url,
            status: "running",
            live_url: null,
            claim_url: null,
            error: null,
            response: null,
            deploy_config: body.options?.deploy ?? null,
            skip_deploy: body.skip_deploy ?? false,
            preview_url: null,
            created_at: Date.now(),
            updated_at: Date.now(),
          })
        }

        void runBuild(directory, jobId, {
          ...body,
          sessionID: sessionId,
          prependInstruction: !isContinuation,
        })
        log.info("build started", { job_id: jobId, session_id: sessionId, directory })

        return c.json(
          {
            job_id: jobId,
            session_id: sessionId,
            directory,
            status: "running",
            message: "Build started; results will be sent to webhook.",
          },
          202,
        )
      },
    )
    .get("/preview/:job_id", async (c) => {
      const job_id = c.req.param("job_id")
      const job = jobs.get(job_id)
      if (!job) return c.json({ error: "Job not found" }, 404)
      const root = await getDeployDir(job.directory, {
        deploy_dir: job.deploy_config?.netlify?.deploy_dir,
      })
      if (!root) return c.json({ error: "No preview directory for this job" }, 404)
      const index = path.join(root, "index.html")
      try {
        const file = Bun.file(index)
        if (await file.exists()) {
          return new Response(file, {
            headers: { "Content-Type": "text/html" },
          })
        }
      } catch {
        /* ignore */
      }
      return c.json({ error: "No index.html in deploy directory" }, 404)
    })
    .get("/preview/:job_id/", async (c) => {
      const job_id = c.req.param("job_id")
      const job = jobs.get(job_id)
      if (!job) return c.json({ error: "Job not found" }, 404)
      const root = await getDeployDir(job.directory, {
        deploy_dir: job.deploy_config?.netlify?.deploy_dir,
      })
      if (!root) return c.json({ error: "No preview directory for this job" }, 404)
      const index = path.join(root, "index.html")
      const indexFile = Bun.file(index)
      if (await indexFile.exists()) {
        return new Response(indexFile, { headers: { "Content-Type": "text/html" } })
      }
      return c.json({ error: "No index.html in deploy directory" }, 404)
    })
    .get("/preview/:job_id/*", async (c) => {
      const job_id = c.req.param("job_id")
      let subpath = c.req.param("*") ?? ""
      const job = jobs.get(job_id)
      if (!job) return c.json({ error: "Job not found" }, 404)
      const root = await getDeployDir(job.directory, {
        deploy_dir: job.deploy_config?.netlify?.deploy_dir,
      })
      if (!root) return c.json({ error: "No preview directory for this job" }, 404)
      if (!subpath || subpath === "/") {
        const index = path.join(root, "index.html")
        const indexFile = Bun.file(index)
        if (await indexFile.exists()) {
          return new Response(indexFile, { headers: { "Content-Type": "text/html" } })
        }
        return c.json({ error: "No index.html in deploy directory" }, 404)
      }
      subpath = subpath.replace(/^\//, "")
      const requested = path.join(root, subpath)
      const resolved = path.resolve(requested)
      if (!resolved.startsWith(path.resolve(root))) {
        return c.json({ error: "Invalid path" }, 400)
      }
      const file = Bun.file(resolved)
      if (!(await file.exists())) return c.json({ error: "Not found" }, 404)
      const stat = await file.stat()
      if (stat?.isDirectory()) {
        const index = path.join(resolved, "index.html")
        const indexFile = Bun.file(index)
        if (await indexFile.exists()) {
          return new Response(indexFile, { headers: { "Content-Type": "text/html" } })
        }
        return c.json({ error: "Not found" }, 404)
      }
      const mime =
        { html: "text/html", css: "text/css", js: "application/javascript", json: "application/json", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", ico: "image/x-icon", svg: "image/svg+xml", woff2: "font/woff2" }[
          path.extname(resolved).slice(1).toLowerCase()
        ] || "application/octet-stream"
      return new Response(file, { headers: { "Content-Type": mime } })
    })
    .post(
      "/:job_id/send",
      describeRoute({
        summary: "Send a message to the session (session-based)",
        description:
          "Send a prompt/message to this build session. The agent has full context of the session. Use this to modify the site or ask follow-ups. No JSON instruction is prepended (conversational).",
        operationId: "build.send",
        responses: {
          202: {
            description: "Message sent; result will be sent to webhook.",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    job_id: z.string(),
                    session_id: z.string(),
                    status: z.enum(["running"]),
                    message: z.string(),
                  }),
                ),
              },
            },
          },
          ...errors(404, 409),
        },
      }),
      validator("param", z.object({ job_id: z.string() })),
      validator("json", z.object({ prompt: z.string(), webhook_url: z.string().url().optional() })),
      async (c) => {
        const { job_id } = c.req.valid("param")
        const body = c.req.valid("json")
        const job = jobs.get(job_id)
        if (!job) return c.json({ error: "Job not found" }, 404)
        if (job.status === "running") {
          return c.json({ error: "Session busy; wait for previous message to complete" }, 409)
        }
        job.status = "running"
        job.updated_at = Date.now()
        if (body.webhook_url) job.webhook_url = body.webhook_url
        void runBuild(job.directory, job_id, {
          prompt: body.prompt,
          sessionID: job.session_id,
          prependInstruction: false,
        })
        log.info("build send", { job_id: job_id, session_id: job.session_id })
        return c.json(
          {
            job_id: job.job_id,
            session_id: job.session_id,
            status: "running",
            message: "Message sent; results will be sent to webhook.",
          },
          202,
        )
      },
    )
    .get(
      "/:job_id",
      describeRoute({
        summary: "Get build status",
        description: "Get current status and result URL for a build job.",
        operationId: "build.status",
        responses: {
          200: {
            description: "Build status",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    job_id: z.string(),
                    session_id: z.string(),
                    directory: z.string(),
                    status: z.enum(["running", "completed", "failed"]),
                    preview_url: z.string().nullable(),
                    live_url: z.string().nullable(),
                    claim_url: z.string().nullable(),
                    error: z.string().nullable(),
                    response: z.string().nullable(),
                    updated_at: z.number(),
                  }),
                ),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ job_id: z.string() })),
      async (c) => {
        const { job_id } = c.req.valid("param")
        const job = jobs.get(job_id)
        if (!job) return c.json({ error: "Job not found" }, 404)
        return c.json({
          job_id: job.job_id,
          session_id: job.session_id,
          directory: job.directory,
          status: job.status,
          preview_url: job.preview_url,
          live_url: job.live_url,
          claim_url: job.claim_url,
          error: job.error,
          response: job.response,
          updated_at: job.updated_at,
        })
      },
    )
    .post(
      "/:job_id/deploy",
      describeRoute({
        summary: "Deploy a completed build to Netlify",
        description:
          "Runs the Netlify deploy step for an existing job (e.g. after previewing and modifying). Job must exist; deploy uses the job's directory and config.",
        operationId: "build.deploy",
        responses: {
          200: {
            description: "Deploy completed",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    job_id: z.string(),
                    live_url: z.string(),
                    claim_url: z.string().nullable(),
                  }),
                ),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ job_id: z.string() })),
      async (c) => {
        const { job_id } = c.req.valid("param")
        const job = jobs.get(job_id)
        if (!job) return c.json({ error: "Job not found" }, 404)
        if (job.status === "running") {
          return c.json({ error: "Build still running; wait for completion before deploying" }, 409)
        }
        const netlifyConfig = job.deploy_config?.netlify ?? {}
        const canDeploy =
          process.env.NETLIFY_PERSONAL_ACCESS_TOKEN &&
          (netlifyConfig.site_id ?? process.env.NETLIFY_TEAM_SLUG)
        if (!canDeploy) {
          return c.json(
            { error: "Netlify not configured: set NETLIFY_PERSONAL_ACCESS_TOKEN and NETLIFY_TEAM_SLUG" },
            400,
          )
        }
        const result = await deployToNetlify(job.directory, job_id, {
          site_id: netlifyConfig.site_id,
          team_slug: netlifyConfig.team_slug,
          deploy_dir: netlifyConfig.deploy_dir,
        })
        if (result && "error" in result) {
          job.updated_at = Date.now()
          await notifyWebhook(job, { deploy_error: result.error })
          return c.json({ error: result.error }, 500)
        }
        job.live_url = result.live_url
        job.claim_url = result.claim_url
        job.updated_at = Date.now()
        await notifyWebhook(job)
        return c.json({
          job_id: job.job_id,
          live_url: result.live_url,
          claim_url: result.claim_url,
        })
      },
    ),
)
