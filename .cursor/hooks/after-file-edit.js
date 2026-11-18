#!/usr/bin/env node
const { readStdin } = require('./adapter');

// Edit accumulation, console.log warnings, and the design-quality reminder
// run from postToolUse via posttooluse-dispatcher.js. Running them here as
// well would fire those warnings twice. Format and typecheck stay on stop.
readStdin().then(() => {
  process.exit(0);
}).catch(() => process.exit(0));
