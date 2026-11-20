/*! dsh-kbar | MIT License | Copyright (c) 2026 adengou */
window.__ModuleLoader__.load({
  id: 'dsh-kbar',
  factory(require) {
    const React = require('react')
    const { useEffect, useRef, useState, useSyncExternalStore } = React
    const h = React.createElement

    const ZH = typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '')
    const TEXT = ZH
      ? {
          title: 'KBar 命令面板',
          openLabel: '打开命令面板',
          placeholder: '搜索会话，或输入动作…',
          dragHint: '拖动移动，双击复位',
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
          dragHint: 'Drag to move, double-click to reset',
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

      function withTimeout(promise, ms = 6000) {
        return Promise.race([
          promise,
          new Promise((_resolve, reject) => setTimeout(() => reject(new Error('remote call timed out')), ms)),
        ])
      }

      async function withSession(fn) {
        const row = currentSession()
        if (!row) return undefined
        const run = async () => {
          if (ctx.sessions && typeof ctx.sessions.using === 'function') {
            return ctx.sessions.using(row.id, { source: 'kbar' }, async (reference) => {
              const state = reference.binding.session.getSnapshot()
              if (state.openState !== 'open') throw state.openError || new Error('session not open')
              return fn(row)
            })
          }
          return fn(row)
        }
        try {
          return await withTimeout(Promise.resolve(run()))
        } catch {
          return undefined
        }
      }

      function fetchJson(url, timeoutMs = 20000) {
        return new Promise((resolve, reject) => {
          try {
            const xhr = new XMLHttpRequest()
            xhr.open('GET', url, true)
            xhr.setRequestHeader('accept', 'application/json')
            xhr.timeout = timeoutMs
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                try {
                  resolve(JSON.parse(xhr.responseText))
                } catch (error) {
                  reject(error)
                }
              } else {
                reject(new Error('catalog status ' + xhr.status))
              }
            }
            xhr.onerror = () => reject(new Error('catalog network error'))
            xhr.ontimeout = () => reject(new Error('catalog timeout'))
            xhr.send()
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

      let loadedCwd = null

      function currentCwd() {
        const row = currentSession()
        return row && typeof row.cwd === 'string' ? row.cwd : undefined
      }

      async function loadPlugins(force = false) {
        const cwd = currentCwd()
        const marker = cwd || null
        if (loading) return
        if (!force && plugins !== null && loadedCwd === marker) return
        loading = true
        try {
          const suffix = cwd ? '?cwd=' + encodeURIComponent(cwd) : ''
          const payload = await fetchJson('/api/kbar/catalog' + suffix, 20000)
          if (payload && payload.ok) {
            if (Array.isArray(payload.plugins)) {
              plugins = payload.plugins
                .filter((bundle) => bundle && typeof bundle.name === 'string')
                .map((bundle) => ({
                  kind: 'plugin',
                  id: 'plugin:' + bundle.name,
                  title: String(bundle.title || bundle.name),
                  secondary: bundle.version ? 'v' + bundle.version : '',
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
            loadedCwd = marker
          }
        } catch {
          /* catalog route unavailable */
        } finally {
          loading = false
        }
        if (state.open) refreshRows()
      }

      async function loadSlashCommands() {
        try {
          const result = await withSession((row) => ctx.remote.commands.list(row.id))
          if (!result || !result.ok || !Array.isArray(result.value)) return
          slashCommands = result.value.map((command) => {
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
                return withSession((row) => ctx.remote.commands.execute(row.id, '/' + command.name, [])).then((outcome) => {
                  if (outcome === undefined) throw new Error('command execution unavailable')
                  if (outcome.ok !== true) {
                    throw new Error((outcome.error && outcome.error.message) || 'command execution failed')
                  }
                })
              },
            }
          })
          if (state.open) refreshRows()
        } catch {
          /* command catalog unavailable */
        }
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
          loadSlashCommands()
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
      dragBar: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 28,
        padding: '0 12px',
        borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.12))',
        color: 'var(--dsw-alias-label-secondary, #808080)',
        fontSize: 11,
        letterSpacing: '0.06em',
        cursor: 'grab',
        userSelect: 'none',
        touchAction: 'none',
      },
      dragDots: {
        fontSize: 15,
        lineHeight: 1,
        opacity: 0.75,
      },
      dragTitle: {
        fontWeight: 600,
      },
      dragHint: {
        marginLeft: 'auto',
        fontSize: 10,
        opacity: 0.65,
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
    }

    function Glyph() {
      return h(
        'svg',
        { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('circle', { cx: 7, cy: 7, r: 4.6, stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', { d: 'M10.4 10.4 14 14', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
      )
    }

    const POSITION_KEY = 'dsh-kbar.position.v1'

    function readPosition() {
      try {
        const raw = localStorage.getItem(POSITION_KEY)
        if (!raw) return null
        const value = JSON.parse(raw)
        if (value && typeof value.x === 'number' && typeof value.y === 'number') return { x: value.x, y: value.y }
      } catch {
        /* ignore a broken saved position */
      }
      return null
    }

    function writePosition(position) {
      try {
        if (position === null) localStorage.removeItem(POSITION_KEY)
        else localStorage.setItem(POSITION_KEY, JSON.stringify(position))
      } catch {
        /* storage unavailable */
      }
    }

    function KBar(props) {
      const store = props.kbar
      const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
      const inputRef = useRef(null)
      const listRef = useRef(null)
      const [position, setPosition] = useState(() => readPosition())
      const positionRef = useRef(position)
      const dragRef = useRef(null)
      const panelRef = useRef(null)
      const backdropRef = useRef(null)

      const applyPosition = (next) => {
        positionRef.current = next
        setPosition(next)
      }

      const startDrag = (event) => {
        if (event.button !== 0) return
        const panel = panelRef.current
        if (!panel) return
        const rect = panel.getBoundingClientRect()
        const drag = {
          offsetX: event.clientX - rect.left,
          offsetY: event.clientY - rect.top,
          width: rect.width,
          baseX: rect.left,
          baseY: rect.top,
          next: { x: rect.left, y: rect.top },
        }
        dragRef.current = drag
        panel.style.position = 'fixed'
        panel.style.left = drag.baseX + 'px'
        panel.style.top = drag.baseY + 'px'
        panel.style.margin = '0'
        panel.style.transition = 'none'
        panel.style.willChange = 'transform'
        panel.style.backdropFilter = 'none'
        if (backdropRef.current) backdropRef.current.style.backdropFilter = 'none'
        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'grabbing'
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          /* pointer capture unavailable */
        }
        event.preventDefault()

        let frame = 0
        const paint = () => {
          frame = 0
          const current = dragRef.current
          if (!current) return
          panel.style.transform =
            'translate3d(' + (current.next.x - drag.baseX) + 'px,' + (current.next.y - drag.baseY) + 'px,0)'
        }
        const onMove = (moveEvent) => {
          if (dragRef.current !== drag) return
          const maxX = Math.max(8, window.innerWidth - drag.width - 8)
          const maxY = Math.max(8, window.innerHeight - 80)
          drag.next = {
            x: Math.round(Math.min(Math.max(moveEvent.clientX - drag.offsetX, 8), maxX)),
            y: Math.round(Math.min(Math.max(moveEvent.clientY - drag.offsetY, 8), maxY)),
          }
          if (frame === 0) frame = requestAnimationFrame(paint)
        }
        const onUp = () => {
          dragRef.current = null
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          if (frame !== 0) cancelAnimationFrame(frame)
          document.body.style.userSelect = ''
          document.body.style.cursor = ''
          panel.style.transform = ''
          panel.style.willChange = ''
          panel.style.transition = ''
          panel.style.backdropFilter = ''
          if (backdropRef.current) backdropRef.current.style.backdropFilter = ''
          applyPosition(drag.next)
          writePosition(drag.next)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
      }

      const resetPosition = () => {
        writePosition(null)
        const panel = panelRef.current
        if (panel) {
          panel.style.transform = ''
          panel.style.willChange = ''
        }
        applyPosition(null)
      }

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
        if (!state.open || positionRef.current === null) return
        const current = positionRef.current
        const maxX = Math.max(8, window.innerWidth - 688)
        const maxY = Math.max(8, window.innerHeight - 120)
        if (current.x > maxX || current.y > maxY) {
          applyPosition({ x: Math.min(current.x, maxX), y: Math.min(current.y, maxY) })
        }
      }, [state.open])

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
          ref: backdropRef,
          style: styles.backdrop,
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) store.close()
          },
        },
        h(
          'div',
          {
            ref: panelRef,
            style: position
              ? { ...styles.panel, position: 'fixed', left: position.x, top: position.y, margin: 0 }
              : styles.panel,
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': TEXT.title,
          },
          h(
            'div',
            {
              style: styles.dragBar,
              title: TEXT.dragHint,
              onPointerDown: startDrag,
              onDoubleClick: resetPosition,
            },
            h('span', { style: styles.dragDots }, '⠿'),
            h('span', { style: styles.dragTitle }, 'KBar'),
            h('span', { style: styles.dragHint }, TEXT.dragHint),
          ),
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

    return {
      inject: ['slots', 'shortcuts', 'sessions', 'uiWorkspace', 'layout', 'remote', 'remote.commands', 'pluginNavigation'],
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

        store.loadPlugins()
      },
    }
  },
})
