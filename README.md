# dsh-kbar

A command palette for DeepSeek Harness. One shortcut to search sessions and run common actions.

- Default shortcut: `Ctrl+Shift+P` on Windows/Linux, `Cmd+Shift+P` on macOS.
- Searches sessions by title and working directory, and runs any registered DSH shortcut command (new session, settings, sidebar, terminal, files, …).
- `↑`/`↓` to select, `Enter` to run, `Esc` to close.

> `Ctrl+K` is already DSH's own session search, so KBar uses `Ctrl+Shift+P` to avoid a shortcut conflict. Rebind it in Settings → Shortcuts if you prefer.

## Install

```sh
# npm
dsh plugin --profile web add dsh-kbar

# GitHub
dsh plugin --profile web add "git+https://github.com/adengou/dsh-kbar.git"

# Gitee mirror
dsh plugin --profile web add "git+https://gitee.com/adengou/dsh-kbar.git"
```

DSH Desktop manages its own profile in the app: install it from **Settings → Plugins**.

## License

MIT
