---
name: security-scan
description: Scan the Cursor project surface under `.cursor/` for security vulnerabilities, misconfigurations, and injection risks using AgentShield. Checks `.cursor/hooks.json`, `.cursor/mcp.json`, `.cursor/rules/`, and `.cursor/agents/`. Use when auditing that Cursor configuration.
metadata:
  origin: ECC
---

# Security Scan Skill

Audit the Cursor configuration under `.cursor/` for security issues using [AgentShield](https://github.com/affaan-m/agentshield).

## When to Activate

- Setting up ECC in a Cursor project
- After modifying `.cursor/hooks.json`, `.cursor/mcp.json`, `.cursor/rules/`, or `.cursor/agents/`
- Before committing those configuration changes
- When onboarding to a repository that already has a `.cursor/` surface
- Periodic security hygiene checks

## What It Scans

| Path | Checks |
|------|--------|
| `.cursor/hooks.json` | Command injection via interpolation, data exfiltration, silent error suppression |
| `.cursor/mcp.json` | Risky MCP servers, hardcoded env secrets, npx supply chain risks |
| `.cursor/rules/` | Hardcoded secrets, auto-run instructions, prompt injection patterns |
| `.cursor/agents/` | Prompts that handle untrusted content without defenses |

## Prerequisites

AgentShield must be installed. Check and install if needed:

```bash
# Check if installed
npx ecc-agentshield --version

# Install globally (recommended)
npm install -g ecc-agentshield

# Or run directly via npx (no install needed)
npx ecc-agentshield scan --path .cursor
```

## Usage

### Basic Scan

Default the scan to this project's `.cursor/` directory (`hooks.json`, `mcp.json`, `rules/`, and `agents/`):

```bash
# Scan the Cursor surface
npx ecc-agentshield scan --path .cursor

# Scan a specific path when one is named
npx ecc-agentshield scan --path /path/to/.cursor

# Scan with minimum severity filter
npx ecc-agentshield scan --path .cursor --min-severity medium
```

### Output Formats

```bash
# Terminal output (default) — colored report with grade
npx ecc-agentshield scan --path .cursor

# JSON — for CI/CD integration
npx ecc-agentshield scan --path .cursor --format json

# Markdown — for documentation
npx ecc-agentshield scan --path .cursor --format markdown

# HTML — self-contained dark-theme report
npx ecc-agentshield scan --path .cursor --format html > security-report.html
```

### Auto-Fix

Apply safe fixes automatically (only fixes marked as auto-fixable):

```bash
npx ecc-agentshield scan --path .cursor --fix
```

This will:
- Replace hardcoded secrets with environment variable references
- Never modify manual-only suggestions

### Opus 4.6 Deep Analysis

Run the adversarial three-agent pipeline for deeper analysis. `ANTHROPIC_API_KEY` must already be set in the environment. Do not write the key into a file.

```bash
npx ecc-agentshield scan --path .cursor --opus --stream
```

This runs:
1. **Attacker (Red Team)** — finds attack vectors
2. **Defender (Blue Team)** — recommends hardening
3. **Auditor (Final Verdict)** — synthesizes both perspectives

### GitHub Action

Add to your CI pipeline. The default path is `.cursor/`:

```yaml
- uses: affaan-m/agentshield@v1
  with:
    path: '.cursor'
    min-severity: 'medium'
    fail-on-findings: true
```

## Severity Levels

| Grade | Score | Meaning |
|-------|-------|---------|
| A | 90-100 | Secure configuration |
| B | 75-89 | Minor issues |
| C | 60-74 | Needs attention |
| D | 40-59 | Significant risks |
| F | 0-39 | Critical vulnerabilities |

## Interpreting Results

### Critical Findings (fix immediately)
- Hardcoded API keys or tokens in `.cursor/` config
- Command injection in `.cursor/hooks.json` via `${file}` interpolation
- Shell-running MCP servers in `.cursor/mcp.json`

### High Findings (fix before production)
- Auto-run instructions in `.cursor/rules/` (prompt injection vector)
- MCP servers with hardcoded env values or unpinned `npx`
- Agent prompts under `.cursor/agents/` that treat fetched content as instructions

### Medium Findings (recommended)
- Silent error suppression in hooks (`2>/dev/null`, `|| true`)
- `npx -y` auto-install in `.cursor/mcp.json`

### Info Findings (awareness)
- Missing descriptions on MCP servers
- Prohibitive instructions correctly flagged as good practice

## Links

- **GitHub**: [github.com/affaan-m/agentshield](https://github.com/affaan-m/agentshield)
- **npm**: [npmjs.com/package/ecc-agentshield](https://www.npmjs.com/package/ecc-agentshield)
