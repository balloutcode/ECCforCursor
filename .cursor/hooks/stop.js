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
    const resolved = resolveAgentDataHome({ preferCursorDefault: true });
    if (resolved && String(resolved).trim()) return resolved;
  } catch {
    // Cursor memory stays under ~/.cursor/ecc even when the resolver cannot load.
  }
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return home ? path.join(home, '.cursor', 'ecc') : path.join('~', '.cursor', 'ecc');
}

function qualityGateScript() {
  const root = getPluginRoot();
  const candidates = [
    path.join(root, 'skills', 'delivery-gate', 'hooks', 'quality-gate.py'),
    path.join(root, '..', 'skills', 'delivery-gate', 'hooks', 'quality-gate.py'),
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || '';
}

function isWindowsAppsAlias(filePath) {
  return /[\\/]WindowsApps[\\/]/i.test(String(filePath || ''));
}

function whereRealExecutable(command) {
  if (process.platform !== 'win32') return '';
  const result = spawnSync('where.exe', [command], {
    encoding: 'utf8',
    timeout: 4000,
    windowsHide: true,
  });
  if (!result || result.status !== 0) return '';
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line && !isWindowsAppsAlias(line)) || '';
}

function discoverWindowsPythons() {
  const roots = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Python'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Python'),
  ].filter(Boolean);
  const found = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^Python3\d+$/i.test(entry.name)) continue;
      const executable = path.join(root, entry.name, 'python.exe');
      if (fs.existsSync(executable)) found.push({ command: executable, args: [] });
    }
    const launcher = path.join(root, 'Launcher', 'py.exe');
    if (fs.existsSync(launcher)) found.push({ command: launcher, args: ['-3'] });
  }
  return found;
}

function pythonLaunchers() {
  const launchers = process.platform === 'win32'
    ? [
      ...discoverWindowsPythons(),
      ...['py', 'python', 'python3'].flatMap(command => {
        const resolved = whereRealExecutable(command);
        if (!resolved) return [];
        return [{ command: resolved, args: command === 'py' ? ['-3'] : [] }];
      }),
    ]
    : [
      { command: 'python3', args: [] },
      { command: 'python', args: [] },
    ];
  const seen = new Set();
  return launchers.filter(launcher => {
    const key = `${launcher.command}\0${launcher.args.join(' ')}`;
    if (seen.has(key) || isWindowsAppsAlias(launcher.command)) return false;
    seen.add(key);
    return true;
  });
}

function isRealPython(launcher) {
  const result = spawnSync(launcher.command, [...launcher.args, '-c', 'import sys; raise SystemExit(0 if sys.version_info[0] >= 3 else 1)'], {
    encoding: 'utf8',
    timeout: 8000,
    windowsHide: true,
  });
  if (!result || result.error || result.status !== 0) return false;
  const text = `${result.stdout || ''}\n${result.stderr || ''}`;
  return !/Microsoft Store|Python was not found/i.test(text);
}

let resolvedPython = null;

function resolvePython() {
  if (resolvedPython !== null) return resolvedPython || null;
  resolvedPython = pythonLaunchers().find(isRealPython) || false;
  return resolvedPython || null;
}

function runPython(script, input, env) {
  const launcher = resolvePython();
  if (!launcher) return null;
  const result = spawnSync(launcher.command, [...launcher.args, script], {
    input,
    encoding: 'utf8',
    env,
    timeout: 15000,
    windowsHide: true,
  });
  if (result.error && result.error.code === 'ENOENT') return null;
  if (result.status === 9009) return null;
  return result;
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
