#!/usr/bin/env node
const { readStdin } = require('./adapter');

// PR creation and build completion are logged by postToolUse through
// posttooluse-dispatcher.js. This event does not log them again.
readStdin().then(raw => {
  process.stdout.write(raw);
}).catch(() => process.exit(0));
