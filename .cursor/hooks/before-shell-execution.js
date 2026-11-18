#!/usr/bin/env node
const {
  readStdin,
  hookEnabled,
  runExistingHook,
  transformToClaude,
} = require('./adapter');

readStdin({ includeMetadata: true })
  .then(({ raw, truncated, readError }) => {
    if (truncated || readError) {
      const hasBlockingGuard = (
        hookEnabled('pre:bash:block-no-verify', ['minimal', 'standard', 'strict'])
        || (
          process.platform !== 'win32'
          && hookEnabled('pre:bash:dev-server-block', ['standard', 'strict'])
        )
      );
      if (hasBlockingGuard) {
        console.error(truncated
          ? '[Cursor Hook] stdin exceeded the safety limit; blocking beforeShellExecution'
          : '[Cursor Hook] stdin read failed; blocking beforeShellExecution');
        process.exit(2);
      }
      console.error(truncated
        ? '[Cursor Hook] stdin exceeded the safety limit; suppressing truncated input'
        : '[Cursor Hook] stdin read failed; suppressing untrusted input');
      process.stdout.write(JSON.stringify({ permission: 'allow' }));
      return;
    }

    try {
      let input;
      let cmd;
      try {
        input = JSON.parse(raw || '{}');
        cmd = String(input.command || input.args?.command || '');
      } catch {
        input = {};
        cmd = String(raw || '');
      }
      // Hook-bypass, tmux, push, and GateGuard run once from preToolUse,
      // which can rewrite the command. This event only returns a permission
      // decision. Dev-server blocking is not in the bash dispatcher.
      if (hookEnabled('pre:bash:dev-server-block', ['standard', 'strict']) && process.platform !== 'win32') {
        const claudeInput = transformToClaude(input, {
          tool_input: { command: cmd },
        });
        runExistingHook('pre-bash-dev-server-block.js', JSON.stringify(claudeInput));
      }
    } catch {
      // noop
    }

    process.stdout.write(JSON.stringify({ permission: 'allow' }));
  })
  .catch(() => process.exit(0));
