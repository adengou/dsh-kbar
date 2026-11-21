/*! dsh-kbar | MIT License | Copyright (c) 2026 adengou */
window.__ModuleLoader__.load({
  id: 'dsh-kbar',
  factory(require) {
    const React = require('react')
    const { useEffect, useRef, useSyncExternalStore } = React
    const h = React.createElement

    const ZH = typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '')
    const TEXT = ZH
      ? {
          title: 'KBar 命令面板',
          openLabel: '打开命令面板',
          placeholder: '搜索会话，或输入动作…',
          closeLabel: '关闭',
          empty: '没有匹配的结果',
          actionGroup: '动作',
          sessionTag: '会话',
          actionTag: '动作',
          commandTag: '命令',
          modelTag: '模型',
          pluginTag: '插件',
          slashTag: '命令',
          skillTag: '技能',
          newSession: '新建会话',
          pluginsPage: '打开插件页',
          hintNavigate: '↑↓ 选择',
          hintRun: '↵ 执行',
          hintClose: 'Esc 关闭',
          results: '{n} 条结果',
        }
      : {
          title: 'KBar command palette',
          openLabel: 'Open the command palette',
          placeholder: 'Search sessions or type an action…',
          closeLabel: 'Close',
          empty: 'No matching results',
          actionGroup: 'Action',
          sessionTag: 'session',
          actionTag: 'action',
          commandTag: 'command',
          modelTag: 'model',
          pluginTag: 'plugin',
          slashTag: 'command',
          skillTag: 'skill',
          newSession: 'New session',
          pluginsPage: 'Open the plugins page',
          hintNavigate: '↑↓ select',
          hintRun: '↵ run',
          hintClose: 'Esc close',
          results: '{n} results',
        }

    function kindLabel(kind) {
      switch (kind) {
        case 'session':
          return TEXT.sessionTag
        case 'command':
          return TEXT.commandTag
        case 'model':
          return TEXT.modelTag
        case 'plugin':
          return TEXT.pluginTag
        case 'slash':
          return TEXT.slashTag
        case 'skill':
          return TEXT.skillTag
        default:
          return TEXT.actionTag
      }
    }

    const IS_MAC = (() => {
      try {
        const p = (navigator.platform || '') + ' ' + (navigator.userAgent || '')
        return /Mac|iPhone|iPad/i.test(p)
      } catch {
        return false
      }
    })()
    const PRIMARY = IS_MAC ? '⌘' : 'Ctrl'
    const OPEN_LABEL = PRIMARY + '+⇧+P'

    function score(query, item) {
      const q = String(query || '').trim().toLowerCase()
      if (q === '') return 1
      const title = String(item.title || '').toLowerCase()
      const extra = String(item.secondary || '').toLowerCase() + ' ' + String(item.keywords || '').toLowerCase()
      if (title.startsWith(q)) return 120
      if (title.includes(q)) return 100 - Math.min(20, title.indexOf(q))
      if (extra.includes(q)) return 70 - Math.min(20, extra.indexOf(q))

      const tokens = q.split(/\s+/).filter(Boolean)
      if (tokens.length > 1) {
        const normTitle = title.replace(/[-_/]+/g, ' ')
        const normExtra = extra.replace(/[-_/]+/g, ' ')
        let total = 0
        for (const token of tokens) {
          if (normTitle.startsWith(token)) total += 40
          else if (normTitle.includes(token)) total += 26
          else if (normExtra.includes(token)) total += 12
          else {
            total = 0
            break
          }
        }
        if (total > 0) return total
      }

      let i = 0
      let last = -1
      let gaps = 0
      for (let j = 0; j < title.length && i < q.length; j++) {
        if (title[j] === q[i]) {
          if (last >= 0) gaps += j - last - 1
          last = j
          i++
        }
      }
      if (i === q.length) return 50 - Math.min(40, gaps)

      const compactTitle = title.replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
      const compactQuery = q.replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
      if (compactQuery === '') return 0
      let matched = 0
      for (let j = 0; j < compactTitle.length && matched < compactQuery.length; j++) {
        if (compactTitle[j] === compactQuery[matched]) matched++
      }
      return matched === compactQuery.length ? 30 : 0
    }

    function clipText(value, max) {
      const chars = Array.from(String(value || ''))
      if (chars.length <= max) return chars.join('')
      return chars.slice(0, max).join('') + '…'
    }

    function copyText(text) {
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          return navigator.clipboard.writeText(text)
        }
      } catch {
        /* clipboard unavailable */
      }
      return undefined
    }

    function createStore(ctx) {
      let state = { open: false, query: '', index: 0, rows: [] }
      let models = []
      let plugins = null
      let slashCommands = []
      let skills = []
      let loading = false
      const listeners = new Set()
      let lastFocus = null
      let closing = false

      const emit = () => {
        for (const listener of listeners) listener()
      }
      const snapshot = () => state
      const subscribe = (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }

      function sessionItems() {
        let snap
        try {
          snap = ctx.sessions.list.getSnapshot()
        } catch {
          return []
        }
        const byId = snap && snap.byId ? snap.byId : {}
        const items = []
        for (const id of Object.keys(byId)) {
          const row = byId[id]
          if (!row || row.blank) continue
          items.push({
            kind: 'session',
            id,
            title: String(row.title || '').trim() || id.slice(0, 8),
            secondary: String(row.cwd || ''),
            keywords: '',
            updatedAt: Number(row.updatedAt) || 0,
            run: () => ctx.uiWorkspace.openSession(id),
          })
        }
        items.sort((a, b) => b.updatedAt - a.updatedAt)
        return items
      }

      function actionItems() {
        return [
          {
            kind: 'action',
            id: 'action:new-session',
            title: TEXT.newSession,
            secondary: '',
            keywords: 'new session new chat 新建 新会话 聊天',
            updatedAt: 0,
            run: () => ctx.uiWorkspace.startSession(),
          },
          {
            kind: 'action',
            id: 'action:plugins',
            title: TEXT.pluginsPage,
            secondary: '',
            keywords: 'plugins plugin manager 插件 管理 市场',
            updatedAt: 0,
            run: () => ctx.layout.selectPanel('plugins'),
          },
        ]
      }

      function commandItems() {
        let rows
        try {
          rows = ctx.shortcuts.catalog.getSnapshot()
        } catch {
          return []
        }
        const focus = lastFocus
        const items = []
        for (const row of rows || []) {
          if (!row || !row.id || row.id === 'kbar.open') continue
          const keys = Array.isArray(row.keys) ? row.keys.join('') : ''
          items.push({
            kind: 'command',
            id: 'cmd:' + row.id,
            commandId: row.id,
            title: String(row.label || '').trim() || row.id,
            secondary: keys,
            keywords: Array.isArray(row.aliases) ? row.aliases.join(' ') : '',
            updatedAt: 0,
            run: () => ctx.shortcuts.invoke(row.id, { modal: null, target: focus }),
          })
        }
        return items
      }

      const RECENT_KEY = 'dsh-kbar.recent.v1'

      function readRecent() {
        try {
          const raw = localStorage.getItem(RECENT_KEY)
          const list = raw ? JSON.parse(raw) : []
          return Array.isArray(list) ? list.filter((value) => typeof value === 'string').slice(0, 20) : []
        } catch {
          return []
        }
      }

      function remember(id) {
        try {
          const list = readRecent().filter((value) => value !== id)
          list.unshift(id)
          localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 20)))
        } catch {
          /* storage unavailable */
        }
      }

      function currentSession() {
        try {
          const rows = Object.values(ctx.sessions.list.getSnapshot().byId || {})
          return rows.find((row) => row && row.retainedBy && (row.retainedBy.mainView || 0) > 0) || null
        } catch {
          return null
        }
      }

      function fetchJson(url, options = {}) {
        const method = options.method || 'GET'
        const body = options.body
        const timeoutMs = options.timeoutMs || 20000
        return new Promise((resolve, reject) => {
          try {
            const xhr = new XMLHttpRequest()
            xhr.open(method, url, true)
            xhr.setRequestHeader('accept', 'application/json')
            if (body !== undefined) xhr.setRequestHeader('content-type', 'application/json')
            xhr.timeout = timeoutMs
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                try {
                  resolve(JSON.parse(xhr.responseText))
                } catch (error) {
                  reject(error)
                }
              } else {
                reject(new Error('kbar http ' + xhr.status))
              }
            }
            xhr.onerror = () => reject(new Error('kbar network error'))
            xhr.ontimeout = () => reject(new Error('kbar timeout'))
            xhr.send(body === undefined ? null : body)
          } catch (error) {
            reject(error)
          }
        })
      }

      async function loadModels() {
        const row = currentSession()
        const directories = ctx.get ? ctx.get('modelDirectories') : undefined
        if (!row || !directories) return
        try {
          const directory = directories.directoryFor(row.id)
          await directory.load()
          const snapshot = directory.store.getSnapshot()
          const current = snapshot.current
          const items = []
          for (const group of snapshot.groups || []) {
            for (const model of group.models || []) {
              const effort = model.reasoning && model.reasoning.defaultEffort
              const isCurrent =
                current !== null &&
                current !== undefined &&
                current.provider === group.id &&
                current.model === model.id
              items.push({
                kind: 'model',
                id: 'model:' + group.id + ':' + model.id,
                title: String(model.name || model.label || model.id),
                secondary: String(group.name || group.id) + (isCurrent ? ' · 当前' : ''),
                current: isCurrent,
                keywords: String(group.id) + ' ' + String(model.id) + ' 模型 model',
                updatedAt: 0,
                run: () => {
                  const selection = { provider: group.id, model: model.id }
                  if (effort !== undefined) selection.reasoningEffort = effort
                  return directory.select(selection)
                },
              })
            }
          }
          models = items.sort((left, right) => Number(right.current) - Number(left.current))
          if (state.open) refreshRows()
        } catch {
          /* models unavailable for this session */
        }
      }

      let loadedMarker = null

      function currentCwd() {
        const row = currentSession()
        return row && typeof row.cwd === 'string' ? row.cwd : undefined
      }

      function currentSessionId() {
        const row = currentSession()
        return row && typeof row.id === 'string' ? row.id : undefined
      }

      function commandItemsFrom(commands) {
        return (Array.isArray(commands) ? commands : [])
          .filter((command) => command && typeof command.name === 'string')
          .map((command) => {
            const needsInput = command.input !== undefined
            const hint = needsInput ? String((command.input && command.input.hint) || '') : ''
            return {
              kind: 'slash',
              id: 'slash:' + command.name,
              title: '/' + command.name,
              secondary: String(command.description || hint || '') + (needsInput ? ' · 需要参数，选中复制' : ''),
              keywords: String(command.description || '') + ' ' + hint + ' 命令 command 斜杠 slash',
              updatedAt: 0,
              run: () => {
                if (needsInput) return copyText('/' + command.name + ' ')
                const sessionId = currentSessionId()
                if (sessionId === undefined) throw new Error('session is not open')
                return fetchJson('/api/kbar/execute', {
                  method: 'POST',
                  body: JSON.stringify({ sessionId, line: '/' + command.name }),
                  timeoutMs: 40000,
                }).then((outcome) => {
                  if (!outcome || outcome.ok !== true) {
                    throw new Error((outcome && outcome.error) || 'command execution failed')
                  }
                })
              },
            }
          })
      }

      async function loadPlugins(force = false) {
        const cwd = currentCwd()
        const sessionId = currentSessionId()
        const marker = (cwd || '') + '|' + (sessionId || '')
        if (loading) return
        if (!force && plugins !== null && loadedMarker === marker) return
        loading = true
        try {
          const params = []
          if (cwd) params.push('cwd=' + encodeURIComponent(cwd))
          if (sessionId) params.push('sessionId=' + encodeURIComponent(sessionId))
          const suffix = params.length ? '?' + params.join('&') : ''
          const payload = await fetchJson('/api/kbar/catalog' + suffix, { timeoutMs: 20000 })
          if (payload && payload.ok) {
            if (Array.isArray(payload.plugins)) {
              plugins = payload.plugins
                .filter((bundle) => bundle && typeof bundle.name === 'string')
                .map((bundle) => ({
                  kind: 'plugin',
                  id: 'plugin:' + bundle.name,
                  title: String(bundle.title || bundle.name),
                  secondary: [bundle.version ? 'v' + bundle.version : '', clipText(bundle.description, 60)]
                    .filter(Boolean)
                    .join(' · '),
                  keywords: String(bundle.name) + ' ' + String(bundle.description || '') + ' 插件 plugin',
                  updatedAt: 0,
                  run: () => ctx.pluginNavigation.openBundle(bundle.name),
                }))
            }
            if (Array.isArray(payload.skills)) {
              skills = payload.skills
                .filter((skill) => skill && typeof skill.name === 'string')
                .map((skill) => ({
                  kind: 'skill',
                  id: 'skill:' + skill.name,
                  title: '/' + skill.name,
                  secondary: String(skill.description || skill.provider || '') + ' · 复制调用命令',
                  keywords: String(skill.description || '') + ' ' + String(skill.provider || '') + ' 技能 skill 斜杠 slash',
                  updatedAt: 0,
                  run: () => copyText('/' + skill.name),
                }))
            }
            slashCommands = commandItemsFrom(payload.commands)
            loadedMarker = marker
          }
        } catch {
          /* catalog route unavailable */
        } finally {
          loading = false
        }
        if (state.open) refreshRows()
      }

      function compute() {
        const query = state.query.trim().toLowerCase()
        const actions = actionItems()
        const commands = commandItems()
        const sessions = sessionItems()
        const recent = readRecent()
        const boost = (item) => (recent.includes(item.id) ? 15 : 0)
        const byRecent = (list) =>
          list
            .map((item, order) => ({ item, order, boost: boost(item) }))
            .sort((a, b) => b.boost - a.boost || a.order - b.order)
            .map((entry) => entry.item)
        if (!query) {
          return actions
            .concat(byRecent(models).slice(0, 6))
            .concat(byRecent(slashCommands).slice(0, 8))
            .concat(byRecent(skills).slice(0, 8))
            .concat(byRecent(commands).slice(0, 6))
            .concat(byRecent(sessions).slice(0, 8))
            .concat(byRecent(plugins || []).slice(0, 8))
        }
        const scored = []
        const slashOnly = query.startsWith('/')
        const pool = slashOnly
          ? slashCommands.concat(skills)
          : actions.concat(models, slashCommands, skills, commands, sessions, plugins || [])
        for (const item of pool) {
          const value = score(query, item)
          if (value > 0) scored.push({ item, value: value + boost(item) })
        }
        scored.sort((a, b) => b.value - a.value || b.item.updatedAt - a.item.updatedAt)
        return scored.slice(0, 50).map((entry) => entry.item)
      }

      function set(patch) {
        state = Object.assign({}, state, patch)
        emit()
      }

      function refreshRows() {
        if (!state.open) return
        const rows = compute()
        set({ rows, index: Math.min(state.index, Math.max(0, rows.length - 1)) })
      }

      return {
        subscribe,
        getSnapshot: snapshot,
        loadPlugins,
        open() {
          if (state.open) return
          try {
            lastFocus = document.activeElement
          } catch {
            lastFocus = null
          }
          set({ open: true, query: '', index: 0, rows: compute() })
          loadModels()
          loadPlugins()
        },
        close() {
          if (!state.open || closing) return
          closing = true
          set({ open: false, query: '', index: 0, rows: [] })
          closing = false
          if (lastFocus && typeof lastFocus.focus === 'function') {
            try {
              lastFocus.focus()
            } catch {
              /* ignore */
            }
          }
          lastFocus = null
        },
        toggle() {
          if (state.open) this.close()
          else this.open()
        },
        setQuery(value) {
          state = Object.assign({}, state, { query: value })
          const rows = compute()
          state = Object.assign({}, state, { rows, index: 0 })
          emit()
        },
        setIndex(index) {
          const max = state.rows.length - 1
          const next = Math.max(0, Math.min(max, index))
          if (next !== state.index) set({ index: next })
        },
        move(delta) {
          if (!state.rows.length) return
          const next = (state.index + delta + state.rows.length) % state.rows.length
          set({ index: next })
        },
        run(index) {
          const item = state.rows[index]
          if (!item) return
          remember(item.id)
          this.close()
          const run = item.run
          setTimeout(() => {
            try {
              const result = run()
              if (result && typeof result.then === 'function') {
                result.catch((error) => console.error('[kbar] action failed', error))
              }
            } catch (error) {
              console.error('[kbar] action failed', error)
            }
          }, 0)
        },
        refresh() {
          refreshRows()
        },
      }
    }

    const styles = {
      backdrop: {
        position: 'fixed',
        inset: 0,
        zIndex: 2147483000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
        background: 'rgba(8, 14, 28, 0.32)',
        backdropFilter: 'blur(3px)',
      },
      panel: {
        width: 'min(680px, 92vw)',
        maxHeight: '62vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRadius: 14,
        border: '1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.22))',
        background: 'var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-base, #ffffff))',
        backdropFilter: 'blur(18px) saturate(1.15)',
        color: 'var(--dsw-alias-label-primary, inherit)',
        boxShadow: '0 24px 64px rgba(0, 0, 0, 0.32), inset 0 0 0 1px rgba(255, 255, 255, 0.06)',
        fontFamily: 'inherit',
      },
      header: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 14px',
        borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.16))',
      },
      closeButton: {
        marginLeft: 2,
        width: 20,
        height: 20,
        padding: 0,
        border: 'none',
        borderRadius: 4,
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        fontSize: 15,
        lineHeight: 1,
        cursor: 'pointer',
      },
      input: {
        flex: 1,
        minWidth: 0,
        border: 'none',
        outline: 'none',
        background: 'transparent',
        color: 'inherit',
        fontSize: 16,
        lineHeight: '24px',
      },
      kbd: {
        flex: 'none',
        fontSize: 11,
        padding: '2px 6px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.3))',
        color: 'var(--dsw-alias-label-secondary, #808080)',
      },
      list: {
        overflowY: 'auto',
        padding: 6,
      },
      row: (selected) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 10px',
        borderRadius: 8,
        cursor: 'pointer',
        background: selected
          ? 'var(--dsw-alias-interactive-bg-hover-accent, var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.16)))'
          : 'transparent',
      }),
      rowMain: {
        flex: 1,
        minWidth: 0,
      },
      rowTitle: {
        fontSize: 14,
        lineHeight: '20px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      rowSecondary: {
        fontSize: 12,
        lineHeight: '16px',
        marginTop: 2,
        color: 'var(--dsw-alias-label-secondary, #808080)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      badge: {
        flex: 'none',
        fontSize: 11,
        color: 'var(--dsw-alias-label-secondary, #808080)',
      },
      empty: {
        padding: '22px 12px',
        textAlign: 'center',
        fontSize: 13,
        color: 'var(--dsw-alias-label-secondary, #808080)',
      },
      footer: {
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '8px 14px',
        fontSize: 11,
        color: 'var(--dsw-alias-label-secondary, #808080)',
        borderTop: '1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.16))',
      },
      count: {
        marginLeft: 'auto',
      },
      sidebarAction: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        minWidth: 0,
        padding: '6px 8px',
        border: 'none',
        borderRadius: 8,
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #808080)',
        font: 'inherit',
        fontSize: 12,
        lineHeight: '18px',
        textAlign: 'left',
        cursor: 'pointer',
      },
      sidebarActionCompact: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        padding: 0,
        border: 'none',
        borderRadius: 8,
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #808080)',
        cursor: 'pointer',
      },
      sidebarLabel: {
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
    }

    function Glyph() {
      return h(
        'svg',
        { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('circle', { cx: 7, cy: 7, r: 4.6, stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', { d: 'M10.4 10.4 14 14', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
      )
    }

    function KBar(props) {
      const store = props.kbar
      const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
      const inputRef = useRef(null)
      const listRef = useRef(null)

      useEffect(() => {
        if (!state.open) return undefined
        const timer = setTimeout(() => {
          const input = inputRef.current
          if (input) {
            input.focus()
            input.select()
          }
        }, 0)
        return () => clearTimeout(timer)
      }, [state.open])

      useEffect(() => {
        if (!state.open) return undefined
        const onKeyDown = (event) => {
          if (event.isComposing) return
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          store.close()
        }
        window.addEventListener('keydown', onKeyDown, true)
        return () => window.removeEventListener('keydown', onKeyDown, true)
      }, [state.open, store])

      useEffect(() => {
        if (!state.open) return
        const list = listRef.current
        if (!list) return
        const row = list.querySelector('[data-index="' + state.index + '"]')
        if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
      }, [state.index, state.open, state.rows])

      if (!state.open) return null
      const rows = state.rows
      const results = TEXT.results.replace('{n}', String(rows.length))

      return h(
        'div',
        {
          style: styles.backdrop,
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) store.close()
          },
        },
        h(
          'div',
          {
            style: styles.panel,
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': TEXT.title,
          },
          h(
            'div',
            { style: styles.header },
            h('span', { style: { display: 'flex', color: 'var(--dsw-alias-label-secondary, #808080)' } }, h(Glyph)),
            h('input', {
              ref: inputRef,
              value: state.query,
              placeholder: TEXT.placeholder,
              'aria-label': TEXT.placeholder,
              style: styles.input,
              spellCheck: false,
              onChange: (event) => store.setQuery(event.target.value),
              onKeyDown: (event) => {
                if (event.isComposing || event.keyCode === 229) return
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  store.move(1)
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  store.move(-1)
                } else if (event.key === 'Enter') {
                  event.preventDefault()
                  store.run(state.index)
                } else if (event.key === 'Tab') {
                  event.preventDefault()
                }
              },
            }),
            h('kbd', { style: styles.kbd }, OPEN_LABEL),
            h(
              'button',
              {
                type: 'button',
                title: TEXT.closeLabel,
                'aria-label': TEXT.closeLabel,
                style: styles.closeButton,
                onClick: () => store.close(),
              },
              '×',
            ),
          ),
          h(
            'div',
            { ref: listRef, style: styles.list, role: 'listbox' },
            rows.length === 0
              ? h('div', { style: styles.empty }, TEXT.empty)
              : rows.map((item, index) =>
                  h(
                    'div',
                    {
                      key: item.id,
                      'data-index': index,
                      role: 'option',
                      'aria-selected': index === state.index,
                      style: styles.row(index === state.index),
                      onMouseEnter: () => store.setIndex(index),
                      onMouseDown: (event) => {
                        event.preventDefault()
                        store.run(index)
                      },
                    },
                    h(
                      'div',
                      { style: styles.rowMain },
                      h('div', { style: styles.rowTitle }, item.title),
                      item.secondary ? h('div', { style: styles.rowSecondary }, item.secondary) : null,
                    ),
                    h('span', { style: styles.badge }, kindLabel(item.kind)),
                  ),
                ),
          ),
          h(
            'div',
            { style: styles.footer },
            h('span', null, TEXT.hintNavigate),
            h('span', null, TEXT.hintRun),
            h('span', null, TEXT.hintClose),
            h('span', { style: styles.count }, results),
          ),
        ),
      )
    }

    function KBarSidebarButton(props) {
      const wide = props.wide === true
      return h(
        'button',
        {
          type: 'button',
          title: TEXT.openLabel + ' (' + OPEN_LABEL + ')',
          'aria-label': TEXT.openLabel,
          style: wide ? styles.sidebarAction : styles.sidebarActionCompact,
          onClick: () => props.open(),
          onMouseEnter: (event) => {
            event.currentTarget.style.background =
              'var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12))'
          },
          onMouseLeave: (event) => {
            event.currentTarget.style.background = 'transparent'
          },
        },
        h('span', { style: { display: 'flex', flex: 'none' } }, h(Glyph)),
        wide ? h('span', { style: styles.sidebarLabel }, TEXT.openLabel) : null,
      )
    }

    return {
      inject: ['slots', 'shortcuts', 'sessions', 'uiWorkspace', 'layout', 'pluginNavigation'],
      apply(ctx) {
        const store = createStore(ctx)

        ctx.effect(() => {
          const off = ctx.sessions.list.subscribe(() => store.refresh())
          return () => {
            if (typeof off === 'function') off()
          }
        }, 'kbar: session catalog')

        ctx.effect(() => {
          const off = ctx.shortcuts.catalog.subscribe(() => store.refresh())
          return () => {
            if (typeof off === 'function') off()
          }
        }, 'kbar: shortcut catalog')

        ctx.effect(() => {
          try {
            const dispose = ctx.shortcuts.register({
              id: 'kbar.open',
              label: () => TEXT.openLabel,
              aliases: ['command palette', 'quick open', 'kbar', '命令面板', '快速打开', '搜索会话'],
              defaults: {
                'desktop:macos': { code: 'KeyP', modifiers: ['primary', 'shift'] },
                'desktop:windows': { code: 'KeyP', modifiers: ['primary', 'shift'] },
                'desktop:linux': { code: 'KeyP', modifiers: ['primary', 'shift'] },
                'web:macos': { code: 'KeyP', modifiers: ['primary', 'shift'] },
                'web:windows': { code: 'KeyP', modifiers: ['primary', 'shift'] },
              },
              regions: ['page', 'editable'],
              modals: [],
              resolve: () => ({ status: 'handled', run: () => store.toggle() }),
            })
            return typeof dispose === 'function' ? dispose : () => {}
          } catch (error) {
            console.warn('[kbar] shortcut unavailable', error)
            return () => {}
          }
        }, 'kbar: shortcut')

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'kbar', inject: () => ({ kbar: store }) },
            KBar,
          ),
        )

        try {
          ctx.slots.inject('sidebar.footer.action', () =>
            ctx.slots.register(
              { name: 'sidebar.footer.action', id: 'kbar', inject: () => ({ open: () => store.open() }) },
              KBarSidebarButton,
            ),
          )
        } catch {
          /* older shell without the footer action slot */
        }

        store.loadPlugins()
      },
    }
  },
})
