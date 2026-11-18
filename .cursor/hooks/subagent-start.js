#!/usr/bin/env node
const { readStdin, hookEnabled } = require('./adapter');
readStdin().then(raw => {
  if (!hookEnabled('subagent:start:audit', ['standard', 'strict'])) {
    process.stdout.write(JSON.stringify({ permission: 'allow' }));
    return;
  }
  try {
    const input = JSON.parse(raw);
    const agent = input.subagent_type || 'unknown';
    console.error(`[ECC] Agent spawned: ${agent}`);
  } catch {
    // Audit-only hook: malformed payloads must not interrupt the agent loop.
  }
  process.stdout.write(JSON.stringify({ permission: 'allow' }));
}).catch(() => process.exit(0));
