#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  createStopFormatTypecheckOptions,
  getPluginRoot,
  hookEnabled,
  interpretHookifyResult,
  loadRuntimeModule,
  readStdin,
  runExistingHook,
  transformToClaude,
} = require('./adapter');

function appendFollowup(current, next) {
  const text = String(next || '').trim();
  if (!text) return current;
  return current ? `${current}\n\n${text}` : text;
}

function agentDataHome() {
  const configured = String(process.env.ECC_AGENT_DATA_HOME || '').trim();
  if (configured) return configured;
  try {
    const { resolveAgentDataHome } = loadRuntimeModule('scripts', 'lib', 'agent-data-home.js');
    return resolveAgentDataHome({ preferCursorDefault: true });
  } catch {
    return '';
  }
}

function qualityGateScript() {
  const root = getPluginRoot();
  const candidates = [
    path.join(root, 'skills', 'delivery-gate', 'hooks', 'quality-gate.py'),
    path.join(root, '..', 'skills', 'delivery-gate', 'hooks', 'quality-gate.py'),
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || '';
}

function runPython(script, input, env) {
  const attempts = process.platform === 'win32'
    ? [['py', ['-3', script]], ['python', [script]], ['python3', [script]]]
    : [['python3', [script]], ['python', [script]]];
  for (const [command, args] of attempts) {
    const result = spawnSync(command, args, {
      input,
      encoding: 'utf8',
      env,
      timeout: 15000,
      windowsHide: true,
    });
    if (result.error && result.error.code === 'ENOENT') continue;
    if (result.status === 9009) continue;
    return result;
  }
  return null;
}

function deliveryGateFollowup(input) {
  if (!hookEnabled('stop:delivery-gate', ['standard', 'strict'])) return '';
  const script = qualityGateScript();
  if (!script) return '';
  const payload = {
    ...input,
    transcript_path: input.transcript_path || input.transcriptPath || '',
    stop_hook_active: Number(input.loop_count) > 0,
    cwd: input.cwd || process.cwd(),
  };
  try {
    const result = runPython(script, JSON.stringify(payload), {
      ...process.env,
      ECC_AGENT_DATA_HOME: agentDataHome(),
    });
    if (!result || result.status !== 2) return '';
    return String(result.stderr || '').trim() || 'Delivery gate blocked this stop.';
  } catch (error) {
    console.error(`[Cursor Hook] delivery-gate skipped: ${error.message}`);
    return '';
  }
}

function hookifyFollowup(input, claudeInput) {
  if (!hookEnabled('stop:hookify-runtime', ['minimal', 'standard', 'strict'])) {
    return { followup: '', context: '' };
  }
  try {
    const hookify = loadRuntimeModule('scripts', 'hooks', 'hookify-runtime.js');
    const payload = {
      ...claudeInput,
      hook_event_name: 'Stop',
      stop_hook_active: Number(input.loop_count) > 0,
      last_assistant_message: typeof input.last_assistant_message === 'string'
        ? input.last_assistant_message
        : '',
      cwd: input.cwd || process.cwd(),
    };
    const result = hookify.run(JSON.stringify(payload), { cwd: payload.cwd });
    if (result && result.stderr) console.error(result.stderr);
    const interpreted = interpretHookifyResult(result);
    if (!interpreted) return { followup: '', context: '' };
    if (interpreted.deny) return { followup: interpreted.message, context: '' };
    return { followup: '', context: interpreted.message || '' };
  } catch (error) {
    console.error(`[Cursor Hook] hookify skipped: ${error.message}`);
    return { followup: '', context: '' };
  }
}

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

  const hookify = hookifyFollowup(input, claudeInput);
  followup = appendFollowup(followup, hookify.followup);
  followup = appendFollowup(followup, deliveryGateFollowup(input));

  if (followup || hookify.context) {
    const output = {};
    if (followup) output.followup_message = followup;
    if (hookify.context) output.additional_context = hookify.context;
    process.stdout.write(JSON.stringify(output));
    return;
  }

  process.stdout.write(raw);
}).catch(() => process.exit(0));
