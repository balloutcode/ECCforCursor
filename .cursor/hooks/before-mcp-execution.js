#!/usr/bin/env node
const { readStdin, hookEnabled, runExistingHook, transformToClaude } = require('./adapter');

const ALLOW = JSON.stringify({ permission: 'allow' });

function claudeMcpInput(input) {
  const server = typeof input.mcp_server_name === 'string' ? input.mcp_server_name : '';
  const tool = typeof input.tool_name === 'string' ? input.tool_name : '';
  const bareTool = tool.replace(/^MCP:/, '');
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
    hook_event_name: 'PreToolUse',
    tool_name: server && bareTool ? `mcp__${server}__${bareTool}` : bareTool,
    server,
    tool: bareTool,
    mcp_server_name: server,
    tool_input: toolInput,
  };
}

function denyMessage(result) {
  const stderr = String(result && result.stderr || '').trim();
  return stderr || 'MCP health check blocked this tool';
}

readStdin().then(raw => {
  let input = {};
  try {
    const parsed = JSON.parse(raw || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      input = parsed;
    }
  } catch {
    input = {};
  }

  if (hookEnabled('pre:mcp-health-check', ['standard', 'strict'])) {
    const result = runExistingHook('mcp-health-check.js', claudeMcpInput(input), {
      captureExitCode: true,
      forwardStderr: true,
      env: { CLAUDE_HOOK_EVENT_NAME: 'PreToolUse' },
    });
    if (result && result.status === 2) {
      process.stdout.write(JSON.stringify({
        permission: 'deny',
        agent_message: denyMessage(result),
      }));
      return;
    }
  }

  if (hookEnabled('pre:mcp:audit', ['standard', 'strict'])) {
    const server = input.mcp_server_name || 'unknown';
    const tool = input.tool_name || 'unknown';
    console.error(`[ECC] MCP invocation: ${server}/${tool}`);
  }

  process.stdout.write(ALLOW);
}).catch(() => process.exit(0));
