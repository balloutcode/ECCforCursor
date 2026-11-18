---
name: configure-ecc
description: "Install and reconfigure ECC for Cursor. The default path is install.ps1 or install.sh with --profile full --target cursor --enable-hooks. This wizard must not write .claude/ or settings.json. Claude Code, Codex, and Kimi are other products and out of scope for this fork. Use when installing, updating, reconfiguring, or repairing the Cursor ECC installation."
metadata:
  origin: ECC
---

# Configure ECC

Install this fork into Cursor. Inventory the project, preview the command,
confirm once, then run it. Do not clone https://github.com/affaan-m/ECC, do not
run `ecc setup` or `npx ecc-universal setup`, and do not copy plugin files by
hand. This fork was adapted from ECC 2.2.3. Updates come from
https://github.com/balloutcode/ECCforCursor.

## Cursor: install this fork

This fork's default route is Cursor. From the repository root, install the
full profile and enable hooks. The wizard writes under `.cursor/`. It must
not create a `.claude/` directory or a `settings.json` file.

Windows (PowerShell):

```powershell
.\install.ps1 --profile full --target cursor --enable-hooks
```

macOS and Linux:

```bash
./install.sh --profile full --target cursor --enable-hooks
```

Confirm once before running the command. After it exits 0, verify
`.cursor/hooks.json`, `.cursor/rules/`, `.cursor/agents/`, and
`.cursor/skills/` are present, and that this run did not create `.claude/`
or `settings.json`. Memory for the install is `ECC_AGENT_DATA_HOME`, which
defaults to `~/.cursor/ecc`.

The plugin name is `ecc-for-cursor`. Repository:
https://github.com/balloutcode/ECCforCursor.

## Other products

Claude Code, Codex, OpenCode, Kimi, and DeepSeek Harness are other products.
This fork does not install or configure them. Do not write `.claude/`,
`.codex/`, `.opencode/`, `.kimi/`, or `settings.json`.

If a prompt asks for those installers, say they are out of scope and repeat
the Cursor commands above. The Claude Code scope wizard, the Codex marketplace
install, and the Kimi `./.kimi-code` install are not part of this skill.
