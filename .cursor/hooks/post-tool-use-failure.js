#!/usr/bin/env node
const { hookEnabled, loadRuntimeModule, readStdin, runExistingHook, transformToClaude } = require('./adapter');

function isMcpTool(input) {
  const toolName = String(input.tool_name || '');
  if (toolName.startsWith('MCP:') || toolName.startsWith('mcp__')) return true;
  return typeof input.mcp_server_name === 'string' && input.mcp_server_name.trim() !== '';
}

function isSkillTool(input) {
  return String(input.tool_name || '').trim().toLowerCase() === 'skill';
}

function claudeSkillFailureInput(input) {
  let toolInput = input.tool_input;
  if (typeof toolInput === 'string') {
    try {
      toolInput = JSON.parse(toolInput);
    } catch {
      toolInput = {};
    }
  }
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) {
    toolInput = {};
  }
  const claude = transformToClaude(input, { tool_input: toolInput });
  return {
    ...claude,
    hook_event_name: 'PostToolUseFailure',
    tool_name: 'Skill',
    tool_input: toolInput,
    error_message: input.error_message || '',
    failure_type: input.failure_type || '',
  };
}

function claudeMcpInput(input) {
  const server = typeof input.mcp_server_name === 'string' ? input.mcp_server_name : '';
  const tool = String(input.tool_name || '').replace(/^MCP:/, '');
  let toolInput = input.tool_input;
  if (typeof toolInput === 'string') {
    try {
      toolInput = JSON.parse(toolInput);
    } catch {
      toolInput = {};
    }
  }
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) {
    toolInput = {};
  }
  const claude = transformToClaude(input, { tool_input: toolInput });
  return {
    ...claude,
    hook_event_name: 'PostToolUseFailure',
    tool_name: server && tool ? `mcp__${server}__${tool}` : tool,
    server,
    tool,
    mcp_server_name: server,
    tool_input: toolInput,
    error_message: input.error_message || '',
    failure_type: input.failure_type || '',
  };
}

readStdin().then(raw => {
  let input = {};
  try {
    const parsed = JSON.parse(raw || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed;
  } catch {
    input = {};
  }

  if (isSkillTool(input) && hookEnabled('post:skill:track', ['standard', 'strict'])) {
    try {
      const tracker = loadRuntimeModule('scripts', 'hooks', 'skill-run-tracker.js');
      tracker.run(JSON.stringify(claudeSkillFailureInput(input)));
    } catch (error) {
      console.error(`[Cursor Hook] skill-run-tracker skipped: ${error.message}`);
    }
  }

  if (!isMcpTool(input) || !hookEnabled('post:mcp-health-check', ['standard', 'strict'])) {
    process.stdout.write('{}');
    return;
  }

  const result = runExistingHook('mcp-health-check.js', claudeMcpInput(input), {
    captureExitCode: true,
    forwardStderr: true,
    env: { CLAUDE_HOOK_EVENT_NAME: 'PostToolUseFailure' },
  });
  const stderr = String(result && result.stderr || '').trim();
  process.stdout.write(stderr
    ? JSON.stringify({ additional_context: stderr })
    : '{}');
}).catch(error => {
  console.error(`[Cursor Hook] postToolUseFailure failed: ${error.message}`);
  process.stdout.write('{}');
});
