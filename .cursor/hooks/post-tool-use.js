#!/usr/bin/env node
const { readStdin, runExistingHook, transformToClaude } = require('./adapter');

function claudeToolName(cursorName) {
  const name = String(cursorName || '');
  if (name === 'Shell') return 'Bash';
  if (name === 'StrReplace' || name === 'ApplyPatch' || name === 'search_replace') return 'Edit';
  if (name === 'EditNotebook') return 'NotebookEdit';
  return name;
}

function claudeToolInput(input) {
  const source = input.tool_input && typeof input.tool_input === 'object' && !Array.isArray(input.tool_input)
    ? input.tool_input
    : {};
  const command = source.command || input.command || '';
  const filePath = source.file_path || source.path || input.file_path || input.path || '';
  return {
    ...source,
    ...(command ? { command: String(command) } : {}),
    ...(filePath ? { file_path: String(filePath) } : {}),
  };
}

function claudeToolOutput(input) {
  if (typeof input.tool_output === 'string' || (input.tool_output && typeof input.tool_output === 'object')) {
    return input.tool_output;
  }
  if (typeof input.output === 'string') return input.output;
  if (typeof input.result_json === 'string') return input.result_json;
  return '';
}

function additionalContextFrom(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return '';
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '';
    const parts = [];
    if (parsed.decision === 'block' && typeof parsed.reason === 'string' && parsed.reason.trim()) {
      parts.push(parsed.reason.trim());
    }
    const extra = parsed.hookSpecificOutput && parsed.hookSpecificOutput.additionalContext;
    if (typeof extra === 'string' && extra.trim()) parts.push(extra.trim());
    return parts.join('\n\n');
  } catch {
    return '';
  }
}

readStdin().then(raw => {
  let input = {};
  try {
    const parsed = JSON.parse(raw || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed;
  } catch {
    input = {};
  }

  const toolInput = claudeToolInput(input);
  const toolOutput = claudeToolOutput(input);
  const claude = transformToClaude(input, {
    tool_input: toolInput,
    tool_output: typeof toolOutput === 'string' ? { output: toolOutput } : toolOutput,
  });
  const claudeInput = {
    ...claude,
    hook_event_name: 'PostToolUse',
    tool_name: claudeToolName(input.tool_name),
    tool_input: toolInput,
    tool_output: toolOutput,
    cwd: input.cwd || process.cwd(),
  };
  const claudeRaw = JSON.stringify(claudeInput);
  const contexts = [];

  for (const mode of ['sync', 'async']) {
    const result = runExistingHook('posttooluse-dispatcher.js', claudeRaw, {
      args: [mode],
      captureExitCode: true,
      forwardStderr: true,
      timeout: mode === 'async' ? 45000 : 30000,
      env: { CLAUDE_HOOK_EVENT_NAME: 'PostToolUse' },
    });
    const context = additionalContextFrom(result && result.stdout);
    if (context) contexts.push(context);
  }

  const additionalContext = contexts.filter(Boolean).join('\n\n');
  process.stdout.write(additionalContext
    ? JSON.stringify({ additional_context: additionalContext })
    : '{}');
}).catch(error => {
  console.error(`[Cursor Hook] postToolUse failed: ${error.message}`);
  process.stdout.write('{}');
});
