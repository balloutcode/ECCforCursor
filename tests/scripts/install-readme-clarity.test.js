/**
 * Regression coverage for the Cursor install instructions in README.md.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const README = path.join(__dirname, '..', '..', 'README.md');

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing install README clarity ===\n');

  let passed = 0;
  let failed = 0;
  const readme = fs.readFileSync(README, 'utf8');

  if (test('README installs a new Cursor project by plugin and by script', () => {
    assert.ok(readme.includes('## Install with the Cursor plugin'));
    assert.ok(readme.includes('## Install into a new project'));
    assert.ok(readme.includes('.\\install.ps1 --profile full --target cursor --enable-hooks'));
    assert.ok(readme.includes('./install.sh --profile full --target cursor --enable-hooks'));
    assert.ok(readme.includes('https://github.com/balloutcode/eccforcursor'));
    assert.ok(readme.includes('Node.js 18 or newer'));
    assert.ok(readme.includes('`.cursor/agents/ecc-*.md`'));
    assert.ok(readme.includes('does not copy this repository\'s root `AGENTS.md` into `.cursor/`'));
  })) passed++; else failed++;

  if (test('README does not give install instructions for other harnesses', () => {
    for (const heading of [
      '## Install with Claude Code',
      '## Install ECC',
      '### Claude Code details',
      '### Codex App and CLI',
      '### Pick one path only',
    ]) {
      assert.ok(!readme.includes(heading), `README should not include ${heading}`);
    }
    assert.ok(!readme.includes('--target claude'));
    assert.ok(!readme.includes('--target codex'));
    assert.ok(!readme.includes('--target kimi'));
    assert.ok(!readme.includes('--target opencode'));
    assert.ok(!readme.includes('npx ecc-universal@'));
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
