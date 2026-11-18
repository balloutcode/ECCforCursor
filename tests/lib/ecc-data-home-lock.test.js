'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { acquireDataHomeLock } = require('../../scripts/lib/ecc-data-home-lock');

function restoreEnv(saved) {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function snapshotEnv() {
  return {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    ECC_AGENT_DATA_HOME: process.env.ECC_AGENT_DATA_HOME,
  };
}

async function owner(root, targetPath, dataHome) {
  const child = spawn(process.execPath, [
    path.join(__dirname, 'helpers', 'ecc-data-home-lock-worker.js'), root, targetPath,
  ], {
    env: { ...process.env, HOME: root, USERPROFILE: root, ECC_AGENT_DATA_HOME: dataHome },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  child.done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stderr }));
  });
  child.done.catch(() => {});
  const deadline = Date.now() + 10000;
  try {
    while (!fs.existsSync(path.join(root, 'held'))) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('Owner failed: ' + stderr);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return child;
  } catch (error) {
    child.kill('SIGKILL');
    await child.done;
    throw error;
  }
}

async function withOwner(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-data-home-lock-'));
  const dataHome = path.join(root, '.cursor', 'ecc');
  const aliasesPath = path.join(dataHome, 'session-aliases.json');
  const saved = snapshotEnv();
  Object.assign(process.env, { HOME: root, USERPROFILE: root, ECC_AGENT_DATA_HOME: dataHome });
  let child;
  try {
    child = await owner(root, aliasesPath, dataHome);
    await callback(root, aliasesPath, child);
  } finally {
    if (child) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await child.done;
    }
    restoreEnv(saved);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const cases = [
  ['default contention is fail-fast; optional timeout is bounded and leaves owner intact', () => withOwner((_root, file) => {
    const before = fs.readFileSync(file + '.ecc.lock', 'utf8');
    assert.throws(() => acquireDataHomeLock(file), /Another ECC process/);
    const start = performance.now();
    assert.throws(() => acquireDataHomeLock(file, { timeoutMs: 50 }), /Another ECC process/);
    assert.ok(performance.now() - start >= 40, 'Waits for the configured deadline');
    assert.ok(performance.now() - start < 5000, 'Does not wait indefinitely');
    assert.strictEqual(fs.readFileSync(file + '.ecc.lock', 'utf8'), before);
    assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['session-aliases.json.ecc.lock']);
  })],
  ['waiting succeeds when the real owner releases after the first contention', () => withOwner(async (root, file, child) => {
    const originalLink = fs.linkSync;
    let contended = false;
    fs.linkSync = function (source, target) {
      try { return originalLink.apply(this, arguments); }
      catch (error) {
        if (target === file + '.ecc.lock' && error.code === 'EEXIST') {
          contended = true;
          fs.writeFileSync(path.join(root, 'release'), '');
        }
        throw error;
      }
    };
    let release;
    try { release = acquireDataHomeLock(file, { timeoutMs: 2000 }); }
    finally { fs.linkSync = originalLink; }
    assert.ok(contended);
    release();
    const result = await child.done;
    assert.strictEqual(result.code, 0, result.stderr);
    assert.ok(!fs.existsSync(file + '.ecc.lock'));
  })],
  ['a killed owner is recovered by the next alias transaction', () => withOwner(async (_root, file, child) => {
    child.kill('SIGKILL');
    await child.done;
    const aliases = require('../../scripts/lib/session-aliases');
    assert.strictEqual(aliases.setAlias('recovered', '/session').success, true);
    assert.ok(aliases.loadAliases().aliases.recovered);
    assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['session-aliases.json']);
  })],
  ['non-contention errors propagate without retry', () => withOwner((_root, file) => {
    const originalLink = fs.linkSync;
    const expected = Object.assign(new Error('disk failure'), { code: 'EIO' });
    let attempts = 0;
    fs.linkSync = () => { attempts++; throw expected; };
    try {
      assert.throws(() => acquireDataHomeLock(file, { timeoutMs: 2000 }), error => error === expected);
      assert.strictEqual(attempts, 1);
    } finally { fs.linkSync = originalLink; }
  })],
  ['recovery tolerates a lock disappearing between inspection and quarantine', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-lock-disappeared-'));
    const file = path.join(root, 'session-aliases.json');
    const lock = file + '.ecc.lock';
    const saved = snapshotEnv();
    Object.assign(process.env, { ECC_AGENT_DATA_HOME: root });
    fs.writeFileSync(lock, '{}');
    fs.utimesSync(lock, new Date(0), new Date(0));
    const originalRename = fs.renameSync;
    let raced = false;
    fs.renameSync = function (source, target) {
      if (source === lock && target.includes('.stale-') && !raced) {
        raced = true;
        fs.unlinkSync(lock);
      }
      return originalRename.apply(this, arguments);
    };
    try {
      // Quarantine IO can consume a short deadline on native Windows runners.
      // Leave room for the next acquisition attempt after the injected ENOENT;
      // the separate contention case verifies the short bounded timeout.
      const release = acquireDataHomeLock(file, { timeoutMs: 2000 });
      assert.ok(raced);
      release();
      assert.deepStrictEqual(fs.readdirSync(root), []);
    } finally {
      fs.renameSync = originalRename;
      restoreEnv(saved);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }],
  ['paths outside the ECC agent data home are refused before creating them', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-lock-outside-'));
    const dataHome = path.join(root, '.cursor', 'ecc');
    const outside = path.join(root, 'outside', 'session-aliases.json');
    const saved = snapshotEnv();
    Object.assign(process.env, { ECC_AGENT_DATA_HOME: dataHome });
    try {
      assert.throws(() => acquireDataHomeLock(outside), /outside the ECC agent data home/);
      assert.strictEqual(fs.existsSync(path.dirname(outside)), false);
      assert.strictEqual(fs.existsSync(dataHome), false);
    } finally {
      restoreEnv(saved);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }],
  ['invalid timeout is rejected before touching disk', () => {
    for (const timeoutMs of [-1, NaN, Infinity, '1']) {
      assert.throws(() => acquireDataHomeLock('unused', { timeoutMs }), /timeoutMs/);
    }
  }],
];
(async () => {
  let passed = 0;
  let failed = 0;
  for (const [name, run] of cases) {
    try { await run(); passed++; console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.stack); }
  }
  console.log('Results: Passed: ' + passed + ', Failed: ' + failed);
  process.exitCode = failed ? 1 : 0;
})();
