# ECCforCursor

ECCforCursor is a standalone Cursor toolkit adapted from [ECC](https://github.com/affaan-m/ECC) 2.2.3 (source commit `3f14a103a8694e51c1df9a806217a6d0b5f7a6f7`). It is not WideAudio. The license remains MIT.

Repository: [github.com/balloutcode/ECCforCursor](https://github.com/balloutcode/ECCforCursor)

Install it into a Cursor project with the Cursor plugin or with `install.ps1` / `install.sh`. This repository does not ship a `.claude/` tree and does not install Claude Code, Codex, Kimi, or OpenCode.

Cursor loads rules from `.cursor/rules/*.mdc` (`description`, `globs`, `alwaysApply`), hooks from `.cursor/hooks.json`, skills from `.cursor/skills/`, commands from `.cursor/commands/`, and agents from `.cursor/agents/ecc-*.md`. Agent files use `model: inherit` and omit `name`, so the agent id is the filename. The installer does not copy this repository's root `AGENTS.md` into `.cursor/`. A host project's own `AGENTS.md` stays at that project's root.

Details of hooks, memory, and agent fields are in [docs/CURSOR.md](docs/CURSOR.md). The map from the original ECC names to Cursor events is in [docs/MIGRATION.md](docs/MIGRATION.md).

## Install with the Cursor plugin

The manifest is `.cursor-plugin/plugin.json`. The plugin name is `ecc-for-cursor`, version `2.2.3`, license `MIT`. `homepage` and `repository` are this GitHub repository. `.cursor-plugin/marketplace.json` lists that same plugin at the repository root, so Customize can import this GitHub repo. Component fields follow the [Plugins reference](https://cursor.com/docs/reference/plugins) and point at `.cursor/`:

| Field | Path |
| --- | --- |
| `rules` | `./.cursor/rules/` |
| `skills` | `./.cursor/skills/` |
| `agents` | `./.cursor/agents/` |
| `commands` | `./.cursor/commands/` |
| `hooks` | `./.cursor/hooks.json` |

When the plugin is listed in the Cursor Marketplace or a team marketplace:

1. Open Customize in the sidebar.
2. Find `ecc-for-cursor`.
3. Select Install and choose **user** scope so later projects can use it. Project scope installs it for the current project only.

To load this checkout before it is listed:

1. Copy the repository to `%USERPROFILE%\.cursor\plugins\local\ecc-for-cursor` (`~/.cursor/plugins/local/ecc-for-cursor`). Keep `.cursor-plugin/plugin.json` and `.cursor/` in that copy. Cursor does not load a symlink whose target is outside `plugins/local`.
2. Run Developer: Reload Window, or restart Cursor.
3. Open Customize and confirm the rules, skills, agents, commands, and hooks.

On Enterprise, an admin turns on Allow Local Plugin Imports under Dashboard → Settings → Security & Identity → Marketplace and Plugins. Submit the public repository at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish). A team admin imports it from Dashboard → Plugins & MCPs → Add Marketplace → Import from Repo.

## Install into a new project

`install.ps1` (Windows) and `install.sh` both call `scripts/install-apply.js`. Run them in the root of the project you want to set up. The `cursor` target writes `./.cursor/` in that directory. Profile `full` with hooks does not need `.claude`, `.opencode`, or `.codex`.

Node.js 18 or newer must be on `PATH`. If `node_modules` is missing next to the script, `install.ps1` runs `npm install --ignore-scripts`.

```powershell
.\install.ps1 --profile full --target cursor --enable-hooks
```

```bash
./install.sh --profile full --target cursor --enable-hooks
```

Pass `--enable-hooks` or `--no-hooks` when the selected profile includes hooks. Without one of those flags the installer describes the hooks and stops before writing.

You can also copy this repository's `.cursor` directory into the project root. That is the same layout the `cursor` target builds. Open the project in Cursor, trust the workspace, and start a new agent session so `sessionStart` runs. Project hooks in `.cursor/hooks.json` run only in a trusted workspace.

## What the project receives

```text
<project>/
  .cursor/
    hooks.json
    ecc-agent-data.json
    hooks/
    scripts/hooks/
    scripts/lib/
    rules/*.mdc
    agents/ecc-*.md
    commands/*.md
    skills/<name>/SKILL.md
```

Session memory is `~/.cursor/ecc` (`%USERPROFILE%\.cursor\ecc` on Windows). `sessionStart` sets `ECC_AGENT_DATA_HOME` for the composer session. Plan Canvas state defaults to `~/.cursor/ecc/plan-canvas`. The `sessions` command loads libraries from `.cursor/scripts/lib` when `CLAUDE_PLUGIN_ROOT` is unset.

## License

MIT. Copyright for the upstream ECC sources remains with their authors. See [LICENSE](LICENSE).
