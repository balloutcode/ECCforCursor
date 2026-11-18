#!/usr/bin/env node
const {
  createStopFormatTypecheckOptions,
  hookEnabled,
  loadRuntimeModule,
  readStdin,
  runExistingHook,
  transformToClaude,
} = require('./adapter');

function planCanvasFollowup(result, sent) {
  const stdout = result && typeof result.stdout === 'string' ? result.stdout : '';
  if (!stdout || stdout === sent) return '';
  try {
    const parsed = JSON.parse(stdout);
    if (parsed && parsed.decision === 'block' && typeof parsed.reason === 'string' && parsed.reason.trim()) {
      return parsed.reason;
    }
  } catch {
    return '';
  }
  return '';
}

readStdin().then(async raw => {
  const input = JSON.parse(raw || '{}');
  const claudeInput = transformToClaude(input);
  const sharedOptions = {
    env: claudeInput.session_id
      ? { CLAUDE_SESSION_ID: claudeInput.session_id }
      : {},
  };

  if (hookEnabled('stop:session-end', ['minimal', 'standard', 'strict'])) {
    runExistingHook('session-end.js', claudeInput, sharedOptions);
  }
  if (hookEnabled('stop:evaluate-session', ['minimal', 'standard', 'strict'])) {
    runExistingHook('evaluate-session.js', claudeInput, sharedOptions);
  }
  if (hookEnabled('stop:cost-tracker', ['minimal', 'standard', 'strict'])) {
    runExistingHook('cost-tracker.js', claudeInput, sharedOptions);
  }
  if (hookEnabled('stop:format-typecheck', ['standard', 'strict'])) {
    runExistingHook(
      'stop-format-typecheck.js',
      claudeInput,
      createStopFormatTypecheckOptions(sharedOptions.env)
    );
  }
  if (hookEnabled('stop:check-console-log', ['standard', 'strict'])) {
    runExistingHook('check-console-log.js', claudeInput, {
      ...sharedOptions,
      forwardStderr: true,
    });
  }
  if (hookEnabled('stop:desktop-notify', ['standard', 'strict'])) {
    try {
      runExistingHook('desktop-notify.js', {
        ...input,
        ...claudeInput,
        hook_event_name: 'Stop',
        last_assistant_message: typeof input.last_assistant_message === 'string'
          ? input.last_assistant_message
          : '',
      }, {
        ...sharedOptions,
        captureExitCode: true,
      });
    } catch (error) {
      console.error(`[Cursor Hook] desktop-notify skipped: ${error.message}`);
    }
  }

  let followup = '';
  if (hookEnabled('stop:plan-canvas-pending', ['minimal', 'standard', 'strict'])) {
    try {
      const pending = loadRuntimeModule('scripts', 'hooks', 'plan-canvas-pending.js');
      const payload = {
        ...input,
        ...claudeInput,
        hook_event_name: 'Stop',
        stop_hook_active: Number(input.loop_count) > 0,
        cwd: input.cwd || process.cwd(),
      };
      const sent = JSON.stringify(payload);
      const result = await pending.run(sent);
      followup = planCanvasFollowup(result, sent);
    } catch (error) {
      console.error(`[Cursor Hook] plan-canvas-pending skipped: ${error.message}`);
    }
  }

  if (followup) {
    process.stdout.write(JSON.stringify({ followup_message: followup }));
    return;
  }

  process.stdout.write(raw);
}).catch(() => process.exit(0));
