---
description: Detect a project's stack and produce a dry-run ECC onboarding plan using the repository's install manifests and stack mappings. Use to onboard ECC into a target project via a reviewable dry-run plan; for general feature discovery and navigation use the ecc-guide skill or /ecc-guide command instead.
---

# /project-init

Create a safe, reviewable ECCforCursor onboarding plan for the current project. This command starts in dry-run mode and only writes files after explicit user approval. This fork was adapted from ECC 2.2.3. Updates come from https://github.com/balloutcode/ECCforCursor.

## Usage

```text
/project-init
/project-init --dry-run
/project-init --target cursor
/project-init --skills continuous-learning-v2,security-review
/project-init --config ecc-install.json
```

## Safety Rules

1. Default to dry-run. Do not modify rules, skills, or install state until the user approves the concrete plan.
2. This fork only writes `.cursor/`. If `.cursor/` already exists, propose a merge. Do not create or edit `CLAUDE.md`, `.claude/`, `.codex/`, `.opencode/`, or `.kimi/`.
3. Use the repository installer. Do not hand-copy files or clone https://github.com/affaan-m/ECC as an install shortcut.
4. Keep permissions narrow. Any generated settings should match detected build/test/lint tools.
5. Report exactly what would change before applying anything.

## Detection Inputs

Read the current project root and detect stack signals from:

- package manager files: `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`
- language manifests: `pyproject.toml`, `requirements.txt`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle`, `build.gradle.kts`
- framework files: `next.config.*`, `vite.config.*`, `tailwind.config.*`, `Dockerfile`, `docker-compose.yml`
- ECC config: `ecc-install.json`
- optional stack map: `config/project-stack-mappings.json` in the ECCforCursor repo

When the checkout is available, use `config/project-stack-mappings.json` as the stack-to-rules/skills reference. If the file is unavailable, fall back to the installed manifests and explicit user choices.

## Planning Flow

1. The target is Cursor. It writes `./.cursor/`. Do not plan `claude`, `codex`, `opencode`, or `kimi`.
2. Detect stacks from project files and show the evidence for each match.
3. Resolve the smallest useful plan:
   - project has an `ecc-install.json`: `node scripts/install-plan.js --config ecc-install.json --json`
   - user named a profile: `node scripts/install-plan.js --profile <profile> --target cursor --json`
   - user named skills: `node scripts/install-plan.js --skills <skill-ids> --target cursor --json`
   - only language stacks are detected: use the legacy language install dry-run with those language names and `--target cursor`
4. Run a dry-run apply command before writing:

```bash
node scripts/install-apply.js --target cursor --dry-run --json <language-or-profile-args>
```

The human install commands, after approval, are:

```powershell
.\install.ps1 --profile full --target cursor --enable-hooks
```

```bash
./install.sh --profile full --target cursor --enable-hooks
```

5. Summarize detected stacks, selected modules, target paths, and files that would change.
6. Ask for approval before applying the non-dry-run command.

## Output Contract

Return:

1. detected stack evidence
2. target: cursor
3. exact dry-run command used
4. exact apply command to run after approval
5. files under `.cursor/` that would be created or changed
6. warnings about existing `.cursor/` files or missing scripts

## Project guidance

Do not generate `CLAUDE.md`. Project rules for this fork live in `.cursor/rules/*.mdc`. A host project's own `AGENTS.md` stays at the project root. Memory is `~/.cursor/ecc`.

## Related

- `config/project-stack-mappings.json` for stack-to-surface hints
- `scripts/install-plan.js` for deterministic plan resolution
- `scripts/install-apply.js` for dry-run and apply operations
- `/ecc-guide` for feature discovery before installing
