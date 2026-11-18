#!/usr/bin/env node
const {
  readStdin,
  hookEnabled,
  readShellPolicyJudgment,
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
      // Dev-server blocking is not in the bash dispatcher.
      if (hookEnabled('pre:bash:dev-server-block', ['standard', 'strict']) && process.platform !== 'win32') {
        const claudeInput = transformToClaude(input, {
          tool_input: { command: cmd },
        });
        runExistingHook('pre-bash-dev-server-block.js', JSON.stringify(claudeInput));
      }
      // Shell policy runs once. preToolUse owns the bash dispatcher (deny and
      // rewrite). This event exits 2 for the same deny without calling that
      // dispatcher again when a judgment for this session command already exists.
      if (hookEnabled('pre:bash:block-no-verify', ['minimal', 'standard', 'strict'])) {
        const sessionId = String(input.conversation_id || input.session_id || '');
        const prior = readShellPolicyJudgment(sessionId, cmd);
        if (prior) {
          if (prior.denied) {
            const reason = prior.stderr.trim() || 'Blocked by ECC pre-bash checks';
            process.stderr.write(reason.endsWith('\n') ? reason : `${reason}\n`);
            process.exit(2);
          }
        } else {
          const cursorInput = input && typeof input === 'object' ? input : { command: cmd };
          const claudeInput = transformToClaude(cursorInput, {
            tool_input: { command: cmd },
          });
          runExistingHook('block-no-verify.js', JSON.stringify(claudeInput));
        }
      }
    } catch {
      // noop
    }

    process.stdout.write(JSON.stringify({ permission: 'allow' }));
  })
  .catch(() => process.exit(0));
