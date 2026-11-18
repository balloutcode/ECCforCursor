'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { resolveAgentDataHome } = require('./agent-data-home');
const { isWithinRoot } = require('./path-safety');

const INVALID_LOCK_STALE_MS = 5 * 60 * 1000;
const acquiredLockIdentities = new WeakMap();

/**
 * Exclusive lock for one file inside the ECC agent data home.
 *
 * Cursor sessionStart sets ECC_AGENT_DATA_HOME (default ~/.cursor/ecc).
 * Session aliases live at session-aliases.json under that root. This module
 * does not lock Claude settings.json.
 */

function sameFileIdentity(left, right) {
  if (left.ino !== right.ino) {
    return false;
  }
  // Node's path-based stats can omit the Windows volume serial (`dev = 0`)
  // while fstat() on the same file handle reports it. Preserve strict device
  // checks everywhere else, including when both Windows stats report a device.
  if (process.platform === 'win32' && (!left.dev || !right.dev)) {
    return true;
  }
  return left.dev === right.dev;
}

function assertDataHomeTarget(targetPath) {
  if (typeof targetPath !== 'string' || targetPath.trim() === '') {
    throw new TypeError('ECC agent data lock target must be a non-empty path.');
  }
  const dataHome = resolveAgentDataHome();
  if (!isWithinRoot(targetPath, dataHome)) {
    throw new Error(
      `Refusing to lock a path outside the ECC agent data home (${dataHome}): ${targetPath}`
    );
  }
}

function createDataHomeLock(lockPath, label = 'ECC agent data') {
  const tempPath = `${lockPath}.create-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  let descriptor;
  let ownedStats;
  try {
    descriptor = fs.openSync(tempPath, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      token: crypto.randomBytes(16).toString('hex'),
    })}\n`);
    fs.fsyncSync(descriptor);
    ownedStats = fs.fstatSync(descriptor, { bigint: true });
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.linkSync(tempPath, lockPath);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
  fs.rmSync(tempPath, { force: true });

  let released = false;
  const release = () => {
    if (released) return;
    const quarantinePath = `${lockPath}.release-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
    fs.renameSync(lockPath, quarantinePath);
    const quarantinedStats = fs.lstatSync(quarantinePath, { bigint: true });
    if (!sameFileIdentity(quarantinedStats, ownedStats)) {
      if (!fs.existsSync(lockPath)) fs.renameSync(quarantinePath, lockPath);
      throw new Error(`Refusing to release a changed ${label} lock: ${lockPath}`);
    }
    released = true;
    fs.rmSync(quarantinePath, { force: true });
  };
  // Retain the identity observed through the creation descriptor. A pathname
  // sampled after publication may already refer to a replacement lock.
  acquiredLockIdentities.set(release, Object.freeze({ dev: ownedStats.dev, ino: ownedStats.ino }));
  return release;
}

function getDataHomeLockIdentity(release) {
  const identity = acquiredLockIdentities.get(release);
  if (!identity) throw new Error('No acquired ECC agent data lock identity for this release function.');
  return identity;
}

function inspectDataHomeLock(lockPath) {
  const descriptor = fs.openSync(lockPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stats = fs.fstatSync(descriptor, { bigint: true });
    const pathStats = fs.lstatSync(lockPath, { bigint: true });
    if (
      !stats.isFile()
      || pathStats.isSymbolicLink()
      || !pathStats.isFile()
      || !sameFileIdentity(stats, pathStats)
    ) {
      return { metadata: null, stats };
    }
    let metadata = null;
    try {
      metadata = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
    } catch (_error) {
      // Invalid locks may be recovered only after the bounded lease below.
    }
    return { metadata, stats };
  } finally {
    fs.closeSync(descriptor);
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function recoverDataHomeLock(lockPath, label = 'ECC agent data') {
  const recoveryPath = `${lockPath}.recover`;
  try {
    fs.mkdirSync(recoveryPath, { mode: 0o700 });
  } catch (error) {
    if (error && error.code === 'EEXIST') return null;
    throw error;
  }

  const quarantinePath = `${lockPath}.stale-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  try {
    let inspected;
    try {
      inspected = inspectDataHomeLock(lockPath);
    } catch (error) {
      if (error && error.code === 'ENOENT') return createDataHomeLock(lockPath, label);
      throw error;
    }
    const validOwner = Number.isSafeInteger(inspected.metadata && inspected.metadata.pid)
      && inspected.metadata.pid > 0;
    const stale = validOwner
      ? !processIsAlive(inspected.metadata.pid)
      : Date.now() - Number(inspected.stats.mtimeMs) >= INVALID_LOCK_STALE_MS;
    if (!stale) return null;

    fs.renameSync(lockPath, quarantinePath);
    const quarantinedStats = fs.lstatSync(quarantinePath, { bigint: true });
    if (!sameFileIdentity(quarantinedStats, inspected.stats)) {
      if (!fs.existsSync(lockPath)) fs.renameSync(quarantinePath, lockPath);
      return null;
    }
    fs.rmSync(quarantinePath, { force: true });
    return createDataHomeLock(lockPath, label);
  } finally {
    fs.rmSync(recoveryPath, { recursive: true, force: true });
    fs.rmSync(quarantinePath, { force: true });
  }
}

/**
 * Acquire exclusive access to a file inside the ECC agent data home.
 * A recovery guard (`<target>.ecc.lock.recover`) is never removed by a
 * contender: if its owner crashes during recovery, inspect and remove the
 * orphaned guard manually only after confirming no ECC process is active.
 * @param {string} targetPath - File protected by the lock
 * @param {object} options - Diagnostic label and bounded wait duration
 * @returns {Function} Release callback for the acquired lock
 */
function acquireDataHomeLock(targetPath, { label = 'ECC agent data', timeoutMs = 0 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new TypeError('Lock timeoutMs must be a finite non-negative number.');
  }
  assertDataHomeTarget(targetPath);
  const lockPath = `${targetPath}.ecc.lock`;
  const deadline = performance.now() + timeoutMs;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  while (true) {
    try {
      return createDataHomeLock(lockPath, label);
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
    }
    try {
      const recovered = recoverDataHomeLock(lockPath, label);
      if (recovered) return recovered;
    } catch (error) {
      // A different writer can acquire or release between inspection and recovery.
      if (!error || (error.code !== 'EEXIST' && !(timeoutMs > 0 && error.code === 'ENOENT'))) throw error;
    }
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      throw new Error(
        `Another ECC process is updating ${label}: ${targetPath}. `
        + `If no ECC process is active, inspect and remove ${lockPath}.`
      );
    }
    Atomics.wait(sleeper, 0, 0, Math.min(10, remaining));
  }
}

function runWithDataHomeLock(targetPath, callback) {
  const releaseLock = acquireDataHomeLock(targetPath);
  let primaryError = null;
  let result;
  try {
    result = callback();
  } catch (error) {
    primaryError = error;
  }

  let releaseError = null;
  try {
    releaseLock();
  } catch (error) {
    releaseError = error;
  }

  if (primaryError) {
    if (releaseError) primaryError.releaseError = releaseError;
    throw primaryError;
  }
  if (releaseError) throw releaseError;
  return result;
}

module.exports = {
  acquireDataHomeLock,
  getDataHomeLockIdentity,
  runWithDataHomeLock,
  sameFileIdentity,
};
