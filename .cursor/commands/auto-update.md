---
description: Pull ECCforCursor and reinstall the Cursor-managed files in the current project.
disable-model-invocation: true
---

# Auto Update

Update this fork from [balloutcode/ECCforCursor](https://github.com/balloutcode/ECCforCursor) and reinstall the Cursor target. This fork was adapted from ECC 2.2.3. Do not fetch or clone https://github.com/affaan-m/ECC to update it.

Run these commands from a checkout whose `origin` is `https://github.com/balloutcode/ECCforCursor.git`. `scripts/auto-update.js` runs `git fetch` and `git pull --ff-only` in that checkout, then reruns `scripts/install-apply.js`. It does not switch remotes by itself. If `origin` still points at `affaan-m/ECC`, point it at `balloutcode/ECCforCursor` before pulling.

## Usage

```powershell
node scripts/auto-update.js --target cursor --dry-run
node scripts/auto-update.js --target cursor
```

```bash
node scripts/auto-update.js --target cursor --dry-run
node scripts/auto-update.js --target cursor
```

Pass `--repo-root` only when the ECCforCursor checkout is not the directory the install state already records.

Memory for the installed project stays at `~/.cursor/ecc`. The reinstall writes `.cursor/` and must not create `.claude/`.

## Notes

- Reinstall is intentional: it applies renames and deletions that a repair pass cannot reconstruct from stale operations.
- Use `--dry-run` before mutating the project.
- Do not resolve the checkout through `~/.claude`, `CLAUDE_PLUGIN_ROOT`, or a Claude Code plugin cache. Those paths are not this fork's install.
