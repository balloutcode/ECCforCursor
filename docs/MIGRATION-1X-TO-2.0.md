# Installing ECCforCursor

This fork does not use the upstream ECC 1.x Claude Code marketplace migration. Upstream ECC 2.0 renamed `affaan-m/everything-claude-code` to `affaan-m/ECC` and the plugin id to `ecc@ecc`. That procedure is Claude Code history. It is not how to install or update ECCforCursor.

## Update source

Updates come from https://github.com/balloutcode/ECCforCursor. This fork was adapted from ECC 2.2.3. Do not run `/plugin marketplace add https://github.com/affaan-m/ECC`, `claude plugin`, or `npx ecc-universal install` for this checkout.

## Cursor install

Plugin name: `ecc-for-cursor`. Memory: `~/.cursor/ecc`.

```powershell
.\install.ps1 --profile full --target cursor --enable-hooks
```

```bash
./install.sh --profile full --target cursor --enable-hooks
```

The `cursor` target writes `./.cursor/`. It does not create `.claude/`, `.codex/`, `.opencode/`, or `.kimi/`.

Details: [README.md](../README.md) and [docs/CURSOR.md](./CURSOR.md).

## Removed guides

These files are not in this fork, so this page no longer links to them: `docs/ANTIGRAVITY-GUIDE.md`, `docs/HERMES-SETUP.md`, `docs/QWEN-GUIDE.md`, `docs/JOYCODE-GUIDE.md`, and the README anchors `claude-code-details` and `reset--uninstall-ecc`.
