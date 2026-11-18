---
name: deepseek-harness-setup
description: "ECCforCursor does not install DeepSeek Harness. Use install.ps1 or install.sh with --profile full --target cursor --enable-hooks. The previous body was only a DeepSeek installer and those steps were removed."
metadata:
  origin: community
---

# DeepSeek Harness Setup

This skill was only a DeepSeek Harness installer (`docs/DEEPSEEK-HARNESS-GUIDE.md` is not in this checkout). ECCforCursor does not install or configure DeepSeek Harness, Claude Code, Codex, OpenCode, or Kimi.

Install this fork into Cursor from https://github.com/balloutcode/ECCforCursor. It was adapted from ECC 2.2.3.

Windows:

```powershell
.\install.ps1 --profile full --target cursor --enable-hooks
```

macOS and Linux:

```bash
./install.sh --profile full --target cursor --enable-hooks
```

Plugin name: `ecc-for-cursor`. Memory: `~/.cursor/ecc`. Do not create `~/.dsh`, `.claude/`, or `settings.json` for this fork.
