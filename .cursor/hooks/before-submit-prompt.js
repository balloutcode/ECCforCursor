#!/usr/bin/env node
const {
  hookEnabled,
  interpretHookifyResult,
  loadRuntimeModule,
  readStdin,
} = require('./adapter');

function promptText(input) {
  return String(input.prompt || input.content || input.message || '');
}

function transcriptPathOf(input) {
  return String(input.transcript_path || input.transcriptPath || '').trim();
}

function contextGateText(input) {
  const transcriptPath = transcriptPathOf(input);
  if (!transcriptPath) return '';
  if (!hookEnabled('user-prompt:context-gate', ['standard', 'strict'])) return '';
  try {
    const gate = loadRuntimeModule('scripts', 'hooks', 'context-gate.js');
    const payload = JSON.stringify({
      ...input,
      prompt: promptText(input),
      transcript_path: transcriptPath,
      session_id: input.session_id || input.conversation_id || '',
      cwd: input.cwd || process.cwd(),
    });
    const out = gate.run(payload);
    if (!out) return '';
    const parsed = JSON.parse(out);
    const text = parsed && parsed.hookSpecificOutput && parsed.hookSpecificOutput.additionalContext;
    return typeof text === 'string' ? text.trim() : '';
  } catch (error) {
    console.error(`[Cursor Hook] context-gate skipped: ${error.message}`);
    return '';
  }
}

function hookifyDecision(input) {
  if (!hookEnabled('prompt:hookify-runtime', ['minimal', 'standard', 'strict'])) return null;
  try {
    const hookify = loadRuntimeModule('scripts', 'hooks', 'hookify-runtime.js');
    const payload = {
      hook_event_name: 'UserPromptSubmit',
      prompt: promptText(input),
      cwd: input.cwd || process.cwd(),
    };
    const result = hookify.run(JSON.stringify(payload), { cwd: payload.cwd });
    if (result && result.stderr) console.error(result.stderr);
    return interpretHookifyResult(result);
  } catch (error) {
    console.error(`[Cursor Hook] hookify skipped: ${error.message}`);
    return null;
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
  const prompt = promptText(input);
  if (hookEnabled('pre:prompt:secret-warning', ['minimal', 'standard', 'strict'])) {
  try {
    const secretPatterns = [
      /sk-[a-zA-Z0-9]{20,}/,       // OpenAI API keys
      /ghp_[a-zA-Z0-9]{36,}/,      // GitHub personal access tokens
      /AKIA[A-Z0-9]{16}/,          // AWS access keys
      /xox[bpsa]-[a-zA-Z0-9-]+/,   // Slack tokens
      /-----BEGIN (RSA |EC )?PRIVATE KEY-----/, // Private keys
    ];
    for (const pattern of secretPatterns) {
      if (pattern.test(prompt)) {
        console.error('[ECC] WARNING: Potential secret detected in prompt!');
        console.error('[ECC] Remove secrets before submitting. Use environment variables instead.');
        break;
      }
    }
  } catch {
    // This warning hook remains advisory when Cursor sends malformed input.
  }
  }

  const hookify = hookifyDecision(input);
  if (hookify && hookify.deny) {
    process.stdout.write(JSON.stringify({
      continue: false,
      agent_message: hookify.message,
    }));
    return;
  }

  const sections = [];
  const gateText = contextGateText(input);
  if (gateText) sections.push(gateText);
  if (hookify && hookify.message) sections.push(hookify.message);
  const output = { continue: true };
  if (sections.length > 0) output.additional_context = sections.join('\n\n');
  process.stdout.write(JSON.stringify(output));
}).catch(() => process.exit(0));
