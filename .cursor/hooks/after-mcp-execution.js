#!/usr/bin/env node
const { readStdin, hookEnabled } = require('./adapter');

function mcpResultFailed(resultJson) {
  if (resultJson == null || resultJson === '') return false;
  if (typeof resultJson === 'object') {
    return Boolean(resultJson.isError || resultJson.is_error || resultJson.error);
  }
  try {
    const parsed = JSON.parse(String(resultJson));
    if (parsed && typeof parsed === 'object') {
      return Boolean(parsed.isError || parsed.is_error || parsed.error);
    }
  } catch {
    return false;
  }
  return false;
}

readStdin().then(raw => {
  if (!hookEnabled('post:mcp:audit', ['standard', 'strict'])) {
    process.stdout.write(raw);
    return;
  }
  try {
    const input = JSON.parse(raw);
    const server = input.mcp_server_name || 'unknown';
    const tool = input.tool_name || 'unknown';
    const success = mcpResultFailed(input.result_json) ? 'FAILED' : 'OK';
    console.error(`[ECC] MCP result: ${server}/${tool} - ${success}`);
  } catch {
    // Audit-only hook: malformed payloads must not interrupt the agent loop.
  }
  process.stdout.write(raw);
}).catch(() => process.exit(0));
