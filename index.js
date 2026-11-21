/*! dsh-kbar | MIT License | Copyright (c) 2026 adengou */
/**
 * Host half of KBar: exposes the profile's bundle catalog, workspace skills and
 * the live session's slash commands to the palette. The palette itself lives in
 * the browser.
 */

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 64 * 1024) throw new Error('request body is too large')
    chunks.push(chunk)
  }
  if (size === 0) return undefined
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export const inject = ['webServer', 'pluginManager']

export function apply(ctx) {
  const agentFor = (sessionId) => {
    if (typeof sessionId !== 'string' || sessionId === '') return undefined
    const agents = ctx.get('agents')
    if (agents === undefined || typeof agents.get !== 'function') return undefined
    return agents.get(sessionId)
  }

  const catalog = async (req, res) => {
    try {
      const requestUrl = new URL(req.url || '/', 'http://localhost')
      const cwd = requestUrl.searchParams.get('cwd') || undefined
      const sessionId = requestUrl.searchParams.get('sessionId') || undefined
      const bundles = await ctx.pluginManager.listBundles()
      const plugins = (Array.isArray(bundles) ? bundles : [])
        .filter((bundle) => bundle && typeof bundle.name === 'string')
        .map((bundle) => {
          const meta = bundle.meta || {}
          const title = typeof meta.title === 'string' ? meta.title : undefined
          return {
            name: bundle.name,
            version: bundle.version,
            description: bundle.description,
            title,
            enabled: bundle.enabled === true,
            installed: bundle.installed === true,
          }
        })

      let skills = []
      const skillsRegistry = ctx.get('skills')
      if (skillsRegistry !== undefined && typeof skillsRegistry.list === 'function') {
        try {
          const summaries = await skillsRegistry.list(cwd === undefined ? {} : { cwd })
          skills = (Array.isArray(summaries) ? summaries : [])
            .filter((skill) => skill && typeof skill.name === 'string')
            .map((skill) => ({
              name: skill.name,
              description: skill.description,
              provider: skill.provider,
            }))
        } catch {
          /* skill catalog unavailable for this workspace */
        }
      }

      let commands = []
      const agent = agentFor(sessionId)
      const commandRegistry = ctx.get('commands')
      if (agent !== undefined && commandRegistry !== undefined && typeof commandRegistry.list === 'function') {
        try {
          commands = commandRegistry
            .list(agent)
            .filter((descriptor) => descriptor && typeof descriptor.name === 'string')
            .map((descriptor) => ({
              name: descriptor.name,
              description: descriptor.description,
              ...(descriptor.input === undefined ? {} : { input: { hint: descriptor.input.hint } }),
            }))
        } catch {
          /* command catalog unavailable for this agent */
        }
      }

      sendJson(res, 200, { ok: true, plugins, skills, commands, generatedAt: Date.now() })
    } catch (error) {
      sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
    }
  }

  const execute = async (req, res) => {
    try {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      const body = await readJson(req)
      const sessionId = body && typeof body.sessionId === 'string' ? body.sessionId : undefined
      const line = body && typeof body.line === 'string' ? body.line : undefined
      if (sessionId === undefined || line === undefined) {
        sendJson(res, 400, { ok: false, error: 'sessionId and line are required' })
        return
      }
      const agent = agentFor(sessionId)
      if (agent === undefined) {
        sendJson(res, 200, { ok: false, error: 'session is not open' })
        return
      }
      const commandRegistry = ctx.get('commands')
      if (commandRegistry === undefined || typeof commandRegistry.execute !== 'function') {
        sendJson(res, 200, { ok: false, error: 'commands are unavailable' })
        return
      }
      const outcome = await commandRegistry.execute(agent, line, [], AbortSignal.timeout(30000))
      if (outcome === undefined) {
        sendJson(res, 200, { ok: false, error: 'unknown command' })
        return
      }
      sendJson(res, 200, {
        ok: outcome.kind === 'success',
        kind: outcome.kind,
        text: typeof outcome.text === 'string' ? outcome.text : undefined,
      })
    } catch (error) {
      sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
    }
  }

  ctx.effect(() => {
    const routes = [
      { kind: 'exact', path: '/api/kbar/catalog', handler: catalog },
      { kind: 'exact', path: '/api/kbar/execute', handler: execute },
    ]
    const disposers = routes.map((route) => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) {
        if (typeof dispose === 'function') dispose()
      }
    }
  }, 'kbar: host routes')
}
