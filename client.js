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
          empty: '没有匹配的结果',
          actionGroup: '动作',
          sessionTag: '会话',
          actionTag: '动作',
          commandTag: '命令',
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
          empty: 'No matching results',
          actionGroup: 'Action',
          sessionTag: 'session',
          actionTag: 'action',
          commandTag: 'command',
          newSession: 'New session',
          pluginsPage: 'Open the plugins page',
          hintNavigate: '↑↓ select',
          hintRun: '↵ run',
          hintClose: 'Esc close',
          results: '{n} results',
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
      const title = String(item.title || '').toLowerCase()
      const extra = String(item.secondary || '').toLowerCase() + ' ' + String(item.keywords || '').toLowerCase()
      if (title.startsWith(query)) return 120
      if (title.includes(query)) return 100 - Math.min(20, title.indexOf(query))
      if (extra.includes(query)) return 70 - Math.min(20, extra.indexOf(query))
      let i = 0
      let last = -1
      let gaps = 0
      for (let j = 0; j < title.length && i < query.length; j++) {
        if (title[j] === query[i]) {
          if (last >= 0) gaps += j - last - 1
          last = j
          i++
        }
      }
      if (i < query.length) return 0
      return 50 - Math.min(40, gaps)
    }

    function createStore(ctx) {
      let state = { open: false, query: '', index: 0, rows: [] }
      let models = []
      let plugins = null
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
            secondary: TEXT.actionGroup,
            keywords: 'new session new chat 新建 新会话 聊天',
            updatedAt: 0,
            run: () => ctx.uiWorkspace.startSession(),
          },
          {
            kind: 'action',
            id: 'action:plugins',
            title: TEXT.pluginsPage,
            secondary: TEXT.actionGroup,
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

      async function loadModels() {
        const row = currentSession()
        const directories = ctx.get ? ctx.get('modelDirectories') : undefined
        if (!row || !directories) return
        try {
          const directory = directories.directoryFor(row.id)
          await directory.load()
          const snapshot = directory.store.getSnapshot()
          const items = []
          for (const group of snapshot.groups || []) {
            for (const model of group.models || []) {
              const effort = model.reasoning && model.reasoning.defaultEffort
              items.push({
                kind: 'model',
                id: 'model:' + group.id + ':' + model.id,
                title: String(model.name || model.label || model.id),
                secondary: String(group.name || group.id),
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
          models = items
          if (state.open) refreshRows()
        } catch {
          /* models unavailable for this session */
        }
      }

      async function loadPlugins() {
        if (plugins !== null || loading) return
        loading = true
        try {
          const result = await ctx.remote.pluginManager.listBundles()
          if (result && result.ok && Array.isArray(result.value)) {
            plugins = result.value
              .filter((bundle) => bundle && bundle.name)
              .map((bundle) => ({
                kind: 'plugin',
                id: 'plugin:' + bundle.name,
                title: String(bundle.displayName || bundle.name),
                secondary: bundle.version ? 'v' + bundle.version : '',
                keywords: String(bundle.name) + ' ' + String(bundle.description || '') + ' 插件 plugin',
                updatedAt: 0,
                run: () => ctx.pluginNavigation.openBundle(bundle.name),
              }))
          }
        } catch {
          /* plugin manager unavailable */
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
        if (!query) {
          return actions
            .concat(models.slice(0, 6))
            .concat(commands.slice(0, 8))
            .concat(sessions.slice(0, 8))
            .concat((plugins || []).slice(0, 8))
        }
        const scored = []
        for (const item of actions.concat(models, commands, sessions, plugins || [])) {
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
        background: 'var(--dsw-alias-bg-mask-2, rgba(0, 0, 0, 0.35))',
        backdropFilter: 'blur(2px)',
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
        color: 'var(--dsw-alias-label-primary, inherit)',
        boxShadow: '0 24px 64px rgba(0, 0, 0, 0.28)',
        fontFamily: 'inherit',
      },
      header: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 14px',
        borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.16))',
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
          ? 'var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.14))'
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
          { style: styles.panel, role: 'dialog', 'aria-modal': 'true', 'aria-label': TEXT.title },
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
                    h('span', { style: styles.badge }, item.kind === 'session' ? TEXT.sessionTag : item.kind === 'command' ? TEXT.commandTag : TEXT.actionTag),
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

    return {
      inject: ['slots', 'shortcuts', 'sessions', 'uiWorkspace', 'layout'],
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

        ctx.effect(
          () =>
            ctx.shortcuts.register({
              id: 'kbar.open',
              label: () => TEXT.openLabel,
              aliases: ['command palette', 'quick open', 'kbar', '命令面板', '快速打开', '搜索会话'],
              defaults: {
                'desktop:macos': { code: 'KeyP', modifiers: ['primary', 'shift'] },
                'desktop:windows': { code: 'KeyP', modifiers: ['primary', 'shift'] },
                'desktop:linux': { code: 'KeyP', modifiers: ['primary', 'shift'] },
                'web:macos': { code: 'KeyP', modifiers: ['primary', 'shift'] },
                'web:windows': { code: 'KeyP', modifiers: ['primary', 'shift'] },
                'web:linux': { code: 'KeyP', modifiers: ['primary', 'shift'] },
              },
              regions: ['page', 'editable'],
              modals: [],
              resolve: () => ({ status: 'handled', run: () => store.toggle() }),
            }),
          'kbar: shortcut',
        )

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'kbar', inject: () => ({ kbar: store }) },
            KBar,
          ),
        )
      },
    }
  },
})
