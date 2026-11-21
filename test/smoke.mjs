// Dependency-free smoke test: loads client.js in a VM with a fake DSH Client
// context and asserts registration, row composition and action wiring.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const code = readFileSync(join(root, 'client.js'), 'utf8')

const clipboard = []
const win = {
  __ModuleLoader__: null,
  addEventListener() {},
  removeEventListener() {},
}
let factory
win.__ModuleLoader__ = { load: (spec) => { factory = spec.factory } }

const sandbox = {
  window: win,
  document: { activeElement: null },
  navigator: {
    language: 'zh-CN',
    platform: 'Win32',
    userAgent: 'node-test',
    clipboard: { writeText: async (text) => { clipboard.push(text) } },
  },
  localStorage: { getItem: () => null, setItem: () => {} },
  setTimeout,
  clearTimeout,
  requestAnimationFrame: (fn) => setTimeout(fn, 16),
  cancelAnimationFrame: (id) => clearTimeout(id),
  AbortController,
  fetch: async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      plugins: [{ name: 'dsh-chubby-whale', version: '1.10.3', title: 'Chubby Whale', description: 'whale pet' }],
      skills: [{ name: 'office', description: 'Office documents', provider: 'filesystem' }],
    }),
  }),
  XMLHttpRequest: class {
    open(method, url) {
      this.method = method
      this.url = url
    }
    setRequestHeader() {}
    send(body) {
      setTimeout(() => {
        this.status = 200
        if (this.url && this.url.includes('/api/kbar/execute')) {
          calls.executed.push(JSON.parse(body).line)
          this.responseText = JSON.stringify({ ok: true, kind: 'success' })
        } else {
          this.responseText = JSON.stringify({
            ok: true,
            plugins: [
              { name: 'dsh-chubby-whale', version: '1.10.3', title: 'Chubby Whale', description: 'whale pet' },
              { name: 'dsh-vision-toolkit', version: '0.1.47', title: 'dsh-vision-toolkit', description: 'vision tools' },
            ],
            skills: [{ name: 'office', description: 'Office documents', provider: 'filesystem' }],
            commands: [
              { name: 'compact', description: 'Compact the conversation' },
              { name: 'plan', description: 'Enter plan mode', input: { hint: '<message>' } },
            ],
          })
        }
        if (this.onload) this.onload()
      }, 0)
    }
  },
  console,
  queueMicrotask,
}
vm.createContext(sandbox)
vm.runInContext(code, sandbox)
assert.ok(factory, 'client.js registers a module factory')

const React = {
  createElement: () => null,
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}

const mod = factory((name) => {
  if (name === 'react') return React
  throw new Error('unexpected require: ' + name)
})
assert.equal(mod.inject.join(','), 'slots,shortcuts,sessions,uiWorkspace,layout,pluginNavigation')

const calls = { executed: [], selected: [], openedBundle: null, invoked: null, openedSession: null }
const directory = {
  load: async () => {},
  store: {
    getSnapshot: () => ({
      groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-flash', name: 'DeepSeek Flash', reasoning: { defaultEffort: 'max' } }] }],
      current: null,
    }),
  },
  select: (selection) => { calls.selected.push(selection) },
}

const ctx = {
  effect: (fn) => { fn() },
  get: (name) => (name === 'modelDirectories' ? { directoryFor: () => directory } : undefined),
  remote: {
    pluginManager: { listBundles: async () => ({ ok: true, value: [{ name: 'dsh-chubby-whale', displayName: 'Chubby Whale', version: '1.10.3' }] }) },
    commands: {
      list: async () => ({
        ok: true,
        value: [
          { name: 'compact', description: 'Compact the conversation' },
          { name: 'plan', description: 'Enter plan mode', input: { hint: '<message>' } },
        ],
      }),
      execute: async (_sessionId, line) => { calls.executed.push(line); return { ok: true } },
    },
    skills: { list: async () => ({ ok: true, value: { skills: [{ name: 'office', description: 'Office documents' }] } }) },
  },
  pluginNavigation: { openBundle: (name) => { calls.openedBundle = name } },
  sessions: {
    list: {
      getSnapshot: () => ({ byId: { s1: { id: 's1', title: 'Test session', retainedBy: { mainView: 1 } } } }),
      subscribe: () => () => {},
    },
  },
  shortcuts: {
    catalog: { getSnapshot: () => [{ id: 'app.terminal', label: 'New terminal', aliases: ['terminal'], keys: [] }], subscribe: () => () => {} },
    register: (spec) => { calls.shortcut = spec; return () => {} },
    invoke: (id) => { calls.invoked = id },
  },
  slots: {
    inject: (_name, fn) => { fn() },
    register: (options) => { calls.slots = calls.slots || []; calls.slots.push(options); return () => {} },
  },
  layout: { selectPanel: () => {} },
  uiWorkspace: { openSession: (id) => { calls.openedSession = id }, startSession: () => {} },
}

mod.apply(ctx)
assert.equal(calls.shortcut.id, 'kbar.open')
assert.equal(JSON.stringify(calls.shortcut.defaults['desktop:windows']), JSON.stringify({ code: 'KeyP', modifiers: ['primary', 'shift'] }))
assert.equal(calls.shortcut.defaults['web:linux'], undefined, 'web:linux has no admitted default')
assert.ok(calls.slots.some((slot) => slot.name === 'shell.overlay'), 'overlay slot registered')
assert.ok(calls.slots.some((slot) => slot.name === 'sidebar.footer.action'), 'sidebar action registered')

const store = calls.slots.find((slot) => slot.name === 'shell.overlay').inject().kbar
calls.shortcut.resolve({}).run()

const wait = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms))
await wait()

const kinds = new Set(store.getSnapshot().rows.map((row) => row.kind))
for (const kind of ['action', 'session', 'command', 'model', 'plugin', 'slash', 'skill']) {
  assert.ok(kinds.has(kind), `rows include ${kind}`)
}

store.setQuery('terminal')
assert.equal(store.getSnapshot().rows.map((row) => row.kind).join(','), 'command')
store.run(0)
await wait(40)
assert.equal(calls.invoked, 'app.terminal')

store.open()
await wait()
store.setQuery('/')
const slashKinds = store.getSnapshot().rows.map((row) => row.kind)
assert.ok(slashKinds.length > 0 && slashKinds.every((kind) => kind === 'slash' || kind === 'skill'), 'slash query lists only slash commands and skills')

store.open()
await wait()
store.setQuery('vision toolkit')
const visionRows = store.getSnapshot().rows
assert.ok(visionRows.length > 0, 'multi-word query matches hyphenated title')
assert.equal(visionRows[0].kind, 'plugin')
assert.ok(visionRows[0].title.includes('vision'), 'multi-word query picks the vision plugin')

store.open()
await wait()
store.setQuery('flash')
store.run(0)
await wait(40)
assert.equal(JSON.stringify(calls.selected), JSON.stringify([{ provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: 'max' }]))

store.open()
await wait()
store.setQuery('chubby')
store.run(0)
await wait(40)
assert.equal(calls.openedBundle, 'dsh-chubby-whale')

store.open()
await wait()
store.setQuery('office')
store.run(0)
await wait(40)
assert.equal(JSON.stringify(clipboard), JSON.stringify(['/office']))

store.open()
await wait()
store.setQuery('compact')
store.run(0)
await wait(40)
assert.equal(JSON.stringify(calls.executed), JSON.stringify(['/compact']))

store.open()
await wait()
store.setQuery('plan')
store.run(0)
await wait(40)
assert.equal(JSON.stringify(clipboard), JSON.stringify(['/office', '/plan ']))
assert.equal(JSON.stringify(calls.executed), JSON.stringify(['/compact']))

store.open()
await wait()
store.setQuery('Test session')
store.run(0)
await wait(40)
assert.equal(calls.openedSession, 's1')

console.log('kbar smoke test passed')
