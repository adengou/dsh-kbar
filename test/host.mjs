// Host-route test: loads index.js with a fake Cordis context and asserts the
// catalog and execute endpoints against fake services.
import assert from 'node:assert/strict'
import { apply } from '../index.js'

const calls = { executed: [] }
const bundles = [
  { name: 'dsh-kbar', version: '0.6.1', description: 'palette', enabled: true, installed: true, meta: { title: 'KBar' } },
  { version: '0.0.0' },
]
const agents = { get: (id) => (id === 'session-1' ? { id: 'session-1' } : undefined) }
const skills = {
  list: async (lookup) =>
    lookup && lookup.cwd
      ? [{ name: 'office', description: 'Office', provider: 'filesystem' }]
      : [{ name: 'runtime-skill', description: 'Runtime', provider: 'runtime' }],
}
const commands = {
  list: (agent) =>
    agent.id === 'session-1'
      ? [
          { name: 'compact', description: 'Compact the conversation' },
          { name: 'plan', description: 'Enter plan mode', input: { hint: '<message>' } },
        ]
      : [],
  execute: async (agent, line, attachments) => {
    calls.executed.push({ agentId: agent.id, line, attachments })
    if (line === '/bad') return { kind: 'error', text: 'nope' }
    return { kind: 'success', text: 'ok' }
  },
}

const routes = {}
const ctx = {
  effect: (fn) => fn(),
  get: (name) => ({ skills, agents, commands })[name],
  pluginManager: { listBundles: async () => bundles },
  webServer: {
    register: (route) => {
      routes[route.path] = route.handler
      return () => {}
    },
  },
}

apply(ctx)
assert.ok(routes['/api/kbar/catalog'], 'catalog route registered')
assert.ok(routes['/api/kbar/execute'], 'execute route registered')

function makeRequest(url, method = 'GET', body) {
  const chunks = body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]
  return {
    url,
    method,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

function makeResponse() {
  const state = { status: 0, headers: {}, body: '' }
  return {
    state,
    writeHead(status, headers) {
      state.status = status
      state.headers = headers
    },
    end(text) {
      state.body = text
    },
  }
}

async function call(path, request) {
  const pathname = path.split('?')[0]
  const response = makeResponse()
  await routes[pathname](request, response)
  return { status: response.state.status, json: JSON.parse(response.state.body) }
}

const catalog = await call('/api/kbar/catalog?cwd=C%3A%5Cwork&sessionId=session-1', makeRequest('/api/kbar/catalog?cwd=C%3A%5Cwork&sessionId=session-1'))
assert.equal(catalog.status, 200)
assert.equal(catalog.json.ok, true)
assert.equal(catalog.json.plugins.length, 1)
assert.equal(catalog.json.plugins[0].name, 'dsh-kbar')
assert.equal(catalog.json.plugins[0].title, 'KBar')
assert.equal(catalog.json.plugins[0].enabled, true)
assert.equal(catalog.json.skills[0].name, 'office')
assert.equal(catalog.json.commands.length, 2)
assert.equal(catalog.json.commands[1].input.hint, '<message>')

const noSession = await call('/api/kbar/catalog?cwd=C%3A%5Cwork', makeRequest('/api/kbar/catalog?cwd=C%3A%5Cwork'))
assert.equal(noSession.json.ok, true)
assert.deepEqual(noSession.json.commands, [])

const success = await call('/api/kbar/execute', makeRequest('/api/kbar/execute', 'POST', { sessionId: 'session-1', line: '/compact' }))
assert.equal(success.status, 200)
assert.equal(success.json.ok, true)
assert.equal(success.json.kind, 'success')
assert.deepEqual(calls.executed[0], { agentId: 'session-1', line: '/compact', attachments: [] })

const failed = await call('/api/kbar/execute', makeRequest('/api/kbar/execute', 'POST', { sessionId: 'session-1', line: '/bad' }))
assert.equal(failed.json.ok, false)
assert.equal(failed.json.kind, 'error')
assert.equal(failed.json.text, 'nope')

const missingAgent = await call('/api/kbar/execute', makeRequest('/api/kbar/execute', 'POST', { sessionId: 'nope', line: '/compact' }))
assert.equal(missingAgent.json.ok, false)
assert.equal(missingAgent.json.error, 'session is not open')

const wrongMethod = await call('/api/kbar/execute', makeRequest('/api/kbar/execute', 'GET'))
assert.equal(wrongMethod.status, 405)
assert.equal(wrongMethod.json.ok, false)

const missingLine = await call('/api/kbar/execute', makeRequest('/api/kbar/execute', 'POST', { sessionId: 'session-1' }))
assert.equal(missingLine.status, 400)
assert.equal(missingLine.json.ok, false)

console.log('kbar host route test passed')
