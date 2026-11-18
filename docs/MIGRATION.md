# Соответствие Claude Code ECC и этого форка

Форк работает только через файлы и события Cursor. Хуки Claude Code, `settings.json`, `permissions.allow` и каталог агентов Claude Code — имена функций, которые были перенесены. Сессия Cursor их не читает. Каталог `.claude/` в форк не входит.

Короткая карта:

| Понятие Claude Code ECC | Файл или событие Cursor |
| --- | --- |
| `PreToolUse`, matcher `Bash` | `preToolUse`, инструмент `Shell`. Адаптер затем вызывает общие проверки `Bash`. |
| `PostToolUse` | `postToolUse` |
| `Stop` | `stop` |
| `SessionStart` | `sessionStart` |
| Отказ хука и `permissions.deny` | stdout `{ "permission": "deny" }` |
| `permissions.allow` в `settings.json` | В форке нет. Разрешение — `{ "permission": "allow" }` из того же хука. |
| Хуки в `~/.claude/settings.json` | `.cursor/hooks.json`, `"version": 1` |
| Память `~/.claude` | `~/.cursor/ecc`. Путь задаёт `ECC_AGENT_DATA_HOME` и `.cursor/ecc-agent-data.json` (`agentDataHome`). |
| Агент `planner`, файл без префикса, `model: opus` | Файл `.cursor/agents/ecc-planner.md`, поле `model: inherit` |
| Навыки в `~/.claude/skills/` | `.cursor/skills/<имя>/SKILL.md` |
| Команды в `~/.claude/commands/` | `.cursor/commands/*.md`, вызов через `/` |
| Правила без шапки Cursor | `.cursor/rules/*.mdc` с полями `description`, `globs`, `alwaysApply` |
| `AGENTS.md` ECC внутри каталога адаптера | Не копируется в `.cursor/`. Свой `AGENTS.md` проекта остаётся в корне проекта. |

`sessionStart` кладёт в сессию `ECC_AGENT_DATA_HOME` (обычно `~/.cursor/ecc`) и `additional_context`: справку о корне памяти, инстинкты, историческую сводку прошлой сессии и выученные навыки. Подробности — в [CURSOR.md](CURSOR.md).

В новый проект форк попадает в `./.cursor/` текущего каталога. Это делает `install.ps1` (Windows) или `install.sh` с целью `cursor` из README ECC 2.2.3. Готовый каталог `.cursor` этого репозитория можно скопировать в корень проекта: правила в нём уже лежат как `.mdc`.
