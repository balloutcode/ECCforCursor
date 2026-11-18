# Форк ECC только для Cursor

Этот репозиторий ставится в обычный проект Cursor. Рабочая поверхность — каталог `.cursor/` в корне проекта. Память сессий лежит в `~/.cursor/ecc` (в Windows это `%USERPROFILE%\.cursor\ecc`).

Публичный репозиторий: [github.com/balloutcode/ECCforCursor](https://github.com/balloutcode/ECCforCursor). Тот же адрес записан в `homepage` и `repository` манифеста плагина.

Каталог `.claude/` здесь отсутствует намеренно. Хуки Claude Code, файл `settings.json`, список `permissions.allow` и агенты из `.claude/agents/` — это функции Claude Code. Форк их не использует и не создаёт.

Источник состава файлов — раздел Cursor в README ECC 2.2.3 и справка установщика в этом репозитории. События и формат ответа хуков — [документация Cursor Hooks](https://cursor.com/docs/hooks). Правила, навыки, агенты и `AGENTS.md` — [Rules](https://cursor.com/docs/rules), [Agent Skills](https://cursor.com/docs/skills) и [Subagents](https://cursor.com/docs/subagents).

## Установка плагином

Манифест — `.cursor-plugin/plugin.json`. Имя плагина — `ecc-for-cursor`. Поля взяты из [Plugins reference](https://cursor.com/docs/reference/plugins): правила, навыки, агенты, команды и хуки указаны путями внутри `.cursor/`. Рядом лежит `.cursor-plugin/marketplace.json`: Customize импортирует этот репозиторий с GitHub как один плагин с корнем `.`.

Когда плагин уже есть в маркетплейсе Cursor или в командном маркетплейсе:

1. Откройте Customize на боковой панели.
2. Найдите `ecc-for-cursor`.
3. Выберите Install и область user, чтобы плагин был доступен в следующих проектах. Область project ставит его в текущий проект.

Пока репозитория нет в маркетплейсе, загрузите эту копию локально:

1. Скопируйте репозиторий в `%USERPROFILE%\.cursor\plugins\local\ecc-for-cursor` (`~/.cursor/plugins/local/ecc-for-cursor`). В копии остаются `.cursor-plugin/plugin.json` и каталог `.cursor/`. Симлинк на каталог вне `plugins/local` Cursor не загружает.
2. Перезапустите Cursor или выполните Developer: Reload Window.
3. Откройте Customize и проверьте правила, навыки, агенты, команды и хуки.

На Enterprise локальную загрузку включает администратор: Dashboard → Settings → Security & Identity → Marketplace and Plugins → Allow Local Plugin Imports. Публичный Git-репозиторий отправляют на [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish). Командный маркетплейс подключают через Dashboard → Plugins & MCPs → Add Marketplace → Import from Repo.

## Установка в новый проект

В корне репозитория лежат `install.ps1` (Windows) и `install.sh`. Оба передают аргументы в `scripts/install-apply.js`. Справка установщика описывает цель `cursor` так: правила, хуки и связанные конфиги копируются в `./.cursor/` текущего каталога.

`install.ps1` требует Node.js 18 или новее в `PATH`. Если рядом со скриптом нет `node_modules`, он сам запускает `npm install --ignore-scripts`.

Запускайте установщик в корне нового проекта: `./.cursor/` считается от текущего каталога. Профиль `full` с хуками собирает проектный `.cursor` и не требует каталогов `.claude`, `.opencode` или `.codex`.

```powershell
.\install.ps1 --profile full --target cursor --enable-hooks
```

```bash
./install.sh --profile full --target cursor --enable-hooks
```

Если выбранный профиль включает хуки, передайте `--enable-hooks` или `--no-hooks`. Без одного из этих флагов установщик печатает, что умеют хуки, и останавливается до записи.

Языковая команда ищет в `.cursor/rules` файлы `common-*.md` и `<язык>-*.md`. В этом дереве правила уже записаны как `.mdc`. Готовый каталог `.cursor` можно скопировать в корень нового проекта целиком. Это то же размещение, которое цель `cursor` собирает в `./.cursor/`.

После копирования или установки откройте проект в Cursor и подтвердите доверие к workspace. Проектные хуки из `.cursor/hooks.json` запускаются только в доверенном workspace. Новая сессия агента нужна, чтобы отработал `sessionStart`.

Хуки — команды `node .cursor/hooks/...`. Они выполняются от корня проекта, поэтому в `hooks.json` путь начинается с `.cursor/hooks/`.

## Что должно лежать в проекте

```text
<корень проекта>/
  .cursor/
    hooks.json
    ecc-agent-data.json
    hooks/
      adapter.js
      session-start.js
      pre-tool-use.js
      post-tool-use.js
      stop.js
    scripts/
      hooks/
      lib/
    rules/
      *.mdc
    agents/
      ecc-*.md
    commands/
      *.md
    skills/
      <имя-навыка>/SKILL.md
```

| Часть | Зачем |
| --- | --- |
| `hooks.json` | Список событий Cursor. В файле есть `"version": 1`. |
| `hooks/adapter.js` | Переводит stdin Cursor в формат общих скриптов ECC и возвращает ответ, который понимает Cursor. |
| `scripts/hooks` и `scripts/lib` | Реализация проверок. Адаптер ищет их сначала в `.cursor/scripts/`, затем в `scripts/` корня проекта. Копируйте `.cursor` целиком. |
| `ecc-agent-data.json` | Корень памяти. Поле `agentDataHome` указывает на `~/.cursor/ecc`. |
| `rules/*.mdc` | Постоянные правила проекта. У каждого файла есть `description`, `globs` и `alwaysApply`. |
| `agents/ecc-*.md` | Субагенты. Имя файла начинается с `ecc-`, чтобы не столкнуться с агентом пользователя или маркетплейса. |
| `commands/*.md` | Короткие команды чата. В чате агента их вызывают через `/`. |
| `skills/<имя>/SKILL.md` | Навыки. Cursor подхватывает их из `.cursor/skills/` и решает по `description`, когда навык уместен. |

Общие правила ставьте вместе с одним языковым набором, который проект реально использует. Полный набор языков раздувает контекст: правила с `alwaysApply: true` попадают в каждую сессию.

Установщик при копировании каталога `agents` добавляет префикс `ecc-` к имени файла, если его ещё нет. Файл `planner.md` становится `ecc-planner.md`. Корневой `AGENTS.md` в `.cursor/` не копируется.

## Правила

Файл правила — `.mdc` в `.cursor/rules/`. Обычный `.md` в этом каталоге Cursor не считает правилом: у него нет полей `description`, `globs` и `alwaysApply`.

```yaml
---
description: "TypeScript coding style extending common rules"
globs: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"]
alwaysApply: false
---
```

| Поле | Смысл |
| --- | --- |
| `description` | Когда правило уместно. Для режима «применять по смыслу» поле обязательно. |
| `globs` | Маски файлов. Правило подключается, когда в контексте есть подходящий файл. |
| `alwaysApply` | `true` — в каждой сессии. `false` — по маске, по описанию или по явному `@`. |

Общие правила ECC держат `alwaysApply: true`. Языковые правила держат `alwaysApply: false` и задают `globs`. Если `alwaysApply: true`, маски и описание на включение не влияют.

Правило границы памяти — `.cursor/rules/ecc-agent-data-home.mdc`, тоже `alwaysApply: true`. Оно напоминает агенту, что сессии и выученные навыки лежат в `$ECC_AGENT_DATA_HOME`.

## Агенты, навыки и команды

Агент Claude Code `planner` с `model: opus` в этом форке — файл `.cursor/agents/ecc-planner.md`. Поле модели:

```yaml
model: inherit
```

`inherit` берёт модель родительского агента. Если поля `name` нет, Cursor берёт идентификатор из имени файла: `ecc-planner`. В чате это `/ecc-planner`. Документированные поля субагента Cursor: `name`, `description`, `model`, `readonly`, `is_background`.

Навык — каталог с `SKILL.md`. В шапке обязательны `name` и `description`; `name` совпадает с именем каталога. Место навыков плагина — `.cursor/skills/`. Вложенный `.cursor/.agents/` не входит в манифест и в установку Cursor.

Команды — markdown в `.cursor/commands/`. Это короткие точки входа. Основная поверхность workflows — навыки.

## `AGENTS.md`

`AGENTS.md` — обычный markdown без шапки. Cursor читает его в корне проекта и во вложенных каталогах; более близкий файл дополняет родительские инструкции.

Форк не помещает `AGENTS.md` ECC внутрь `.cursor/`. Свой `AGENTS.md` будущего проекта, если он нужен, лежит в корне этого проекта и описывает сам проект.

## Память

`.cursor/ecc-agent-data.json`:

```json
{
  "agentDataHome": "~/.cursor/ecc"
}
```

Порядок выбора корня:

1. Уже заданная переменная `ECC_AGENT_DATA_HOME`.
2. `agentDataHome` из `.cursor/ecc-agent-data.json`. Путь абсолютный или от `~`, без `..`, и остаётся внутри каталога памяти Cursor или Claude Code.
3. Если хук видит `CURSOR_VERSION` или `CURSOR_PROJECT_DIR`, корень `~/.cursor/ecc`.
4. Вне Cursor запасной корень — домашний каталог Claude Code. Сессия Cursor до этого шага не доходит.

Под корнем лежат:

- `session-data/` — сводки сессий
- `skills/learned/` — навыки, собранные из сессий
- `session-aliases.json` — короткие имена сессий
- `metrics/` — метрики
- `plan-canvas/` — состояние Plan Canvas; путь дублируется в `ECC_PLAN_CANVAS_STATE_DIR`

Инстинкты continuous learning v2 остаются отдельно, в `CLV2_HOMUNCULUS_DIR` (по умолчанию `~/.local/share/ecc-homunculus`).

Общая память с Claude Code включается только явно: `ECC_AGENT_DATA_HOME` или `agentDataHome` указывают на `~/.claude`. Для двух сред на одной машине оставьте `~/.cursor/ecc`.

## Что делает `sessionStart`

Событие Cursor `sessionStart` срабатывает при создании сессии composer. Хук `.cursor/hooks/session-start.js` возвращает JSON с `env` и `additional_context`. Cursor передаёт `env` следующим хукам этой сессии и добавляет `additional_context` в начальный контекст.

В `env` попадают:

- `ECC_AGENT_DATA_HOME` — корень памяти, обычно `~/.cursor/ecc`
- `ECC_PLAN_CANVAS_STATE_DIR` — `<корень>/plan-canvas`

В `additional_context` сначала идёт короткая справка об этом корне. Затем общий скрипт сессии добавляет, если вставка контекста включена:

- активные инстинкты: по умолчанию не больше 6, порог уверенности 0.7
- сводку прошлой сессии того же репозитория, обёрнутую как историческую справку, а не как задание на повтор
- до 6 кратких описаний выученных навыков
- обнаруженный тип проекта

Потолок текста — `ECC_SESSION_START_MAX_CHARS`, по умолчанию 8000 символов. `ECC_SESSION_START_CONTEXT=off` или значение `0` у потолка отключает эту вставку. Переменная `env` при этом всё равно выставляется.

`sessionStart` не запускается у cloud agents: у них нет этого события. Локальный Cursor его запускает.

## Что делают `preToolUse`, `postToolUse` и `stop`

Все три имени — события Cursor в `.cursor/hooks.json`. Адаптер внутри переводит имена инструментов к общим скриптам ECC: `Shell` становится `Bash`, `StrReplace` — `Edit`.

### `preToolUse`

Срабатывает до выполнения инструмента. В `hooks.json` стоит `"matcher": "*"`, поэтому вход один на все инструменты.

Проверки командной строки, которые в Claude Code висели на `PreToolUse` с matcher `Bash`, здесь получают инструмент `Shell`. Запрет возвращается так:

```json
{ "permission": "deny", "agent_message": "почему вызов остановлен" }
```

Разрешение — `{ "permission": "allow" }`. Если проверка переписала команду, в том же объекте есть `updated_input`. Код выхода `2` у общего скрипта адаптер тоже превращает в `permission: "deny"`.

Политика shell выполняется из `preToolUse` один раз. Туда входят запрет флагов, которые отключают хуки git, напоминание про tmux и проверка `git push`. Запись `beforeShellExecution` в `hooks.json` этот набор второй раз не прогоняет. Для `Write` и `Edit` тот же хук запускает предупреждения и защиту конфигурации, которые входят в профиль.

Сбой самого хука не блокирует инструмент: в ответ уходит `permission: "allow"`. Для отказа нужен явный `deny` или код выхода `2`.

### `postToolUse`

Срабатывает после успешного инструмента. Адаптер вызывает общий диспетчер `PostToolUse` дважды: синхронно и асинхронно. Если скрипты вернули текст, хук отдаёт его Cursor:

```json
{ "additional_context": "что добавить в разговор после результата инструмента" }
```

Пустой результат — `{}`. Это событие не отменяет уже выполненный вызов. Проверки правок, которые должны случиться один раз, идут отсюда; `afterFileEdit` их не повторяет.

### `stop`

Срабатывает, когда цикл агента закончился. Вход Cursor содержит `status` (`completed`, `aborted` или `error`) и `loop_count`.

Хук сохраняет состояние сессии, оценивает сессию и обновляет учёт. На профилях `standard` и `strict` он дополнительно прогоняет пакетную проверку формата и типов и смотрит `console.log` в изменённых файлах. Формат и типы собираются здесь, а не на каждой правке.

Если нужно продолжить цикл, ответ такой:

```json
{ "followup_message": "следующее сообщение пользователя" }
```

Cursor отправит его сам. У скрипта в `hooks.json` лимит таких продолжений по умолчанию 5 (`loop_limit`). Без `followup_message` цикл на этом останавливается.

Профиль по умолчанию — `standard`. Его задаёт `ECC_HOOK_PROFILE` (`minimal`, `standard`, `strict`). Отдельные проверки отключаются через `ECC_DISABLED_HOOKS`.

## Чего в форке нет

| Функция Claude Code | Как устроен этот форк |
| --- | --- |
| Хуки в `~/.claude/settings.json` и в plugin `hooks/hooks.json` | События в `.cursor/hooks.json`, скрипты в `.cursor/hooks/` |
| `permissions.allow` и `permissions.deny` | Ответ хука `{ "permission": "deny" }` или `{ "permission": "allow" }` |
| Агенты `.claude/agents/` и `model: opus` | `.cursor/agents/ecc-*.md` и `model: inherit` |
| Память в `~/.claude` | `~/.cursor/ecc` |

Повторная установка поверх Claude Code этому форку не нужна: в поставке нет `CLAUDE.md` и каталога `.claude/`. Это инструкции Claude Code, манифест Cursor их не подключает.

В 2.2.4 дополнительно убраны файлы, которые Cursor не загружает и цель `cursor` не копирует: `plugins/README.md`, `manifests/install-assets/claude-project-scripts-package.json` и тесты снятых поверхностей Codex и OpenCode (`docs/CODEX-NAVIGATION-GUIDE.md`, `.codex/`, `.opencode/opencode.json`, `hooks/codex-hooks.json`, `scripts/codex/`, `scripts/sync-ecc-to-codex.sh`). Каталоги `.claude/`, `.codex/`, `.kimi/`, `.opencode/` и `scripts/codex-git-hooks` по-прежнему отсутствуют.
