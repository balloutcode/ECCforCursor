---
name: projects
description: List known projects and their instinct statistics
command: true
---

# Projects Command

List project registry entries and per-project instinct/observation counts for continuous-learning-v2.

## Implementation

Run the instinct CLI using the plugin root path:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/continuous-learning-v2/scripts/instinct-cli.py" projects
```

Or if `CLAUDE_PLUGIN_ROOT` is not set. Claude Code manual installs use `~/.claude/skills/...`. This Cursor install uses the project copy:

```bash
python .cursor/skills/continuous-learning-v2/scripts/instinct-cli.py projects
```

## Usage

```bash
/projects
```

## What to Do

1. Read `~/.local/share/ecc-homunculus/projects.json` (`CLV2_HOMUNCULUS_DIR`). `~/.claude/homunculus/projects.json` is the legacy Claude Code location; do not read or write it.
2. For each project, display:
   - Project name, id, root, remote
   - Personal and inherited instinct counts
   - Observation event count
   - Last seen timestamp
3. Also display global instinct totals
