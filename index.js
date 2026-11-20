/*! dsh-kbar | MIT License | Copyright (c) 2026 adengou */
/**
 * Host half of KBar: exposes the profile's bundle catalog to the palette.
 * The palette itself lives in the browser.
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

export const inject = ['webServer', 'pluginManager']

export function apply(ctx) {
  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path: '/api/kbar/catalog',
      handler: async (req, res) => {
        try {
          const requestUrl = new URL(req.url || '/', 'http://localhost')
          const cwd = requestUrl.searchParams.get('cwd') || undefined
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
          const registry = ctx.get('skills')
          if (registry !== undefined && typeof registry.list === 'function') {
            try {
              const summaries = await registry.list(cwd === undefined ? {} : { cwd })
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
          sendJson(res, 200, { ok: true, plugins, skills, generatedAt: Date.now() })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
        }
      },
    })
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  }, 'kbar: catalog route')
}
