#!/usr/bin/env node
const {
  hookEnabled,
  loadRuntimeModule,
  readStdin,
  runExistingHook,
  transformToClaude,
} = require('./adapter');

const ALLOW = Object.freeze({ permission: 'allow' });
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SUGGEST_TOOLS = new Set(['Edit', 'Write']);
const GOVERNANCE_TOOLS = new Set(['Bash', 'PowerShell', 'Write', 'Edit', 'MultiEdit']);
const POWERSHELL_EXECUTABLES = new Set(['powershell', 'powershell.exe', 'pwsh', 'pwsh.exe']);

function commandBasename(token) {
  const bare = String(token || '').replace(/^["']|["']$/g, '');
  const slash = Math.max(bare.lastIndexOf('/'), bare.lastIndexOf('\\'));
  return bare.slice(slash + 1).toLowerCase();
}

function commandLooksLikePowerShell(command) {
  const tokens = String(command || '').match(/[^\s"']+|"[^"]*"|'[^']*'/g) || [];
  return tokens.some(token => POWERSHELL_EXECUTABLES.has(commandBasename(token)));
}

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

function claudePreToolInput(input, toolName) {
  const toolInput = claudeToolInput(input);
  const claude = transformToClaude(input, { tool_input: toolInput });
  return {
    ...claude,
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: toolInput,
    cwd: input.cwd || process.cwd(),
  };
}

function messageText(value) {
  if (Array.isArray(value)) {
    return value.map(item => String(item || '').trim()).filter(Boolean).join('\n');
  }
  return typeof value === 'string' ? value.trim() : '';
}

function decisionFromClaudeStdout(stdout, originalCommand) {
  const text = String(stdout || '').trim();
  if (!text) return { ...ALLOW };
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...ALLOW };
    const specific = parsed.hookSpecificOutput;
    if (specific && specific.permissionDecision === 'deny') {
      return {
        permission: 'deny',
        agent_message: messageText(specific.permissionDecisionReason) || 'Blocked by ECC pre-tool check',
      };
    }
    const nextCommand = parsed.tool_input && parsed.tool_input.command;
    if (typeof nextCommand === 'string' && nextCommand !== originalCommand) {
      return { permission: 'allow', updated_input: parsed.tool_input };
    }
    const context = messageText(specific && specific.additionalContext);
    if (context) return { permission: 'allow', agent_message: context };
    if (parsed.decision === 'block' && typeof parsed.reason === 'string' && parsed.reason.trim()) {
      return { permission: 'deny', agent_message: parsed.reason.trim() };
    }
  } catch {
    return { ...ALLOW };
  }
  return { ...ALLOW };
}

function decisionFromRun(result, originalCommand) {
  if (result == null || result === '') return { ...ALLOW };
  if (typeof result === 'string') return decisionFromClaudeStdout(result, originalCommand);
  if (result.exitCode === 2) {
    return {
      permission: 'deny',
      agent_message: messageText(result.stderr) || 'Blocked by ECC pre-tool check',
    };
  }
  const context = messageText(result.additionalContext);
  if (context) return { permission: 'allow', agent_message: context };
  if (typeof result.stdout === 'string') return decisionFromClaudeStdout(result.stdout, originalCommand);
  return { ...ALLOW };
}

function shellDecision(originalCommand, result) {
  const stderr = messageText(result && result.stderr);
  if (result && result.status === 2) {
    return {
      permission: 'deny',
      agent_message: stderr || 'Blocked by ECC pre-bash checks',
    };
  }
  const fromStdout = decisionFromClaudeStdout(result.stdout, originalCommand);
  if (fromStdout.permission === 'deny') return fromStdout;
  if (fromStdout.updated_input) return fromStdout;
  if (fromStdout.agent_message) return fromStdout;
  return { ...ALLOW };
}

function mergeDecisions(decisions) {
  const messages = [];
  let denied = false;
  let updatedInput = null;
  for (const decision of decisions) {
    if (!decision) continue;
    if (decision.permission === 'deny') denied = true;
    if (decision.agent_message) messages.push(decision.agent_message);
    if (decision.updated_input) updatedInput = decision.updated_input;
  }
  if (denied) {
    return {
      permission: 'deny',
      agent_message: messages.join('\n\n') || 'Blocked by ECC pre-tool check',
    };
  }
  const output = { permission: 'allow' };
  if (messages.length > 0) output.agent_message = messages.join('\n\n');
  if (updatedInput) output.updated_input = updatedInput;
  return output;
}

function runNamed(scriptName, claudeRaw, options) {
  return runExistingHook(scriptName, claudeRaw, {
    captureExitCode: true,
    forwardStderr: true,
    ...options,
  });
}

readStdin().then(raw => {
  let input = {};
  try {
    const parsed = JSON.parse(raw || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed;
  } catch {
    input = {};
  }

  const cursorName = String(input.tool_name || (input.command || input.tool_input?.command ? 'Shell' : ''));
  const toolName = claudeToolName(cursorName);
  const claudeInput = claudePreToolInput(input, toolName);
  const claudeRaw = JSON.stringify(claudeInput);
  const originalCommand = String(claudeInput.tool_input.command || '');
  const decisions = [];
  const record = (fn) => {
    try {
      decisions.push(fn());
    } catch (error) {
      console.error(`[Cursor Hook] preToolUse check failed: ${error.message}`);
    }
  };

  process.env.CLAUDE_HOOK_EVENT_NAME = 'PreToolUse';

  if (toolName === 'Bash' || toolName === 'PowerShell') {
    const shellInput = { ...claudeInput, tool_name: 'Bash' };
    record(() => shellDecision(
      originalCommand,
      runNamed('pre-bash-dispatcher.js', JSON.stringify(shellInput), { timeout: 20000 })
    ));
  }

  if ((toolName === 'PowerShell' || commandLooksLikePowerShell(originalCommand))
    && hookEnabled('pre:powershell:gateguard-fact-force', ['standard', 'strict'])) {
    record(() => {
      const gate = loadRuntimeModule('scripts', 'hooks', 'gateguard-fact-force.js');
      const payload = JSON.stringify({ ...claudeInput, tool_name: 'PowerShell' });
      return decisionFromRun(gate.run(payload), originalCommand);
    });
  }

  if (toolName === 'Write' && hookEnabled('pre:write:doc-file-warning', ['standard', 'strict'])) {
    record(() => {
      const warning = loadRuntimeModule('scripts', 'hooks', 'doc-file-warning.js');
      return decisionFromRun(warning.run(claudeRaw), originalCommand);
    });
  }

  if (SUGGEST_TOOLS.has(toolName) && hookEnabled('pre:edit-write:suggest-compact', ['standard', 'strict'])) {
    record(() => shellDecision(originalCommand, runNamed('suggest-compact.js', claudeRaw)));
  }

  if (EDIT_TOOLS.has(toolName) && toolName !== 'NotebookEdit'
    && hookEnabled('pre:config-protection', ['standard', 'strict'])) {
    record(() => {
      const protection = loadRuntimeModule('scripts', 'hooks', 'config-protection.js');
      return decisionFromRun(protection.run(claudeRaw), originalCommand);
    });
  }

  if (EDIT_TOOLS.has(toolName) && hookEnabled('pre:edit-write:gateguard-fact-force', ['standard', 'strict'])) {
    record(() => {
      const gate = loadRuntimeModule('scripts', 'hooks', 'gateguard-fact-force.js');
      return decisionFromRun(gate.run(claudeRaw), originalCommand);
    });
  }

  if (GOVERNANCE_TOOLS.has(toolName) && hookEnabled('pre:governance-capture', ['standard', 'strict'])) {
    record(() => {
      const governance = loadRuntimeModule('scripts', 'hooks', 'governance-capture.js');
      return decisionFromRun(governance.run(claudeRaw), originalCommand);
    });
  }

  if (hookEnabled('pre:observe', ['standard', 'strict'])) {
    record(() => {
      const observe = loadRuntimeModule('scripts', 'hooks', 'observe-runner.js');
      return decisionFromRun(observe.run(claudeRaw, { hookId: 'pre:observe' }), originalCommand);
    });
  }

  const merged = mergeDecisions(decisions);
  if (merged.permission === 'deny') {
    process.stdout.write(JSON.stringify({
      permission: 'deny',
      agent_message: merged.agent_message,
    }));
    return;
  }
  const allow = { permission: 'allow' };
  if (merged.updated_input) allow.updated_input = merged.updated_input;
  if (!merged.updated_input && merged.agent_message) allow.agent_message = merged.agent_message;
  process.stdout.write(JSON.stringify(allow));
}).catch(error => {
  console.error(`[Cursor Hook] preToolUse failed: ${error.message}`);
  process.stdout.write(JSON.stringify(ALLOW));
});
