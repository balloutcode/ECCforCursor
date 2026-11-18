---
name: skill-health
description: Show skill portfolio health dashboard with charts and analytics. Use for the quantitative usage/success-rate dashboard; for a qualitative compliance or quality audit use the skill-stocktake skill.
command: true
---

# Skill Health Dashboard

Shows a health dashboard for skills in this ECCforCursor checkout. This fork was adapted from ECC 2.2.3. Do not resolve the script through `~/.claude` or a Claude Code plugin cache.

## Implementation

From the repository root at https://github.com/balloutcode/ECCforCursor:

```bash
node scripts/skills-health.js --dashboard
node scripts/skills-health.js --dashboard --panel failures
node scripts/skills-health.js --dashboard --json
```

## Usage

```
/skill-health
/skill-health --panel failures
/skill-health --json
```

## What to Do

1. Run `scripts/skills-health.js --dashboard` from the checkout.
2. Show the output.
3. If skills are declining, suggest `/evolve`.
4. If amendments are pending, suggest reviewing them.

## Panels

- **Success Rate (30d)** — daily success rates per skill
- **Failure Patterns** — clustered failure reasons
- **Pending Amendments** — proposals awaiting review
- **Version History** — version snapshots per skill

## Snapshot storage

Snapshot creation needs writable storage with hardlink support. The versioning API refuses unsupported storage without a copy fallback. Reading existing health data does not require creating hard links.
