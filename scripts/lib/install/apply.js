'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');

const { readInstallState, writeInstallState } = require('../install-state');
const {
  assertHookConsentReady,
  getRecordedHookConsent,
  planMaterializesHookRuntime,
  shouldDisableAntigravityHooks,
} = require('./hook-consent');
const { filterMcpConfig, parseDisabledMcpServers } = require('../mcp-config');
const { assertWithinTrustedRoot, isWithinRoot } = require('../path-safety');
const { cleanupLegacyAntigravityInstall } = require('./antigravity-legacy-migration');
const {
  assertNoNewUserOwnedFile,
  prepareUserOwnedFileGuard,
  preserveUnwrittenFiles,
} = require('./ownership-guard');
const { writeFileNoFollow } = require('./guarded-write');
const {
  completeExcludedPathsReconciliation,
  prepareExcludedPathsReconciliation,
} = require('./excluded-paths-reconciliation');
const {
  completeStaleOperationsReconciliation,
  describeStaleOperationsPreview,
  prepareStaleOperationsReconciliation,
  withoutStaleOperations,
} = require('./stale-operations-reconciliation');
const { buildInstallIndex, rewriteRelativeLinks } = require('./link-rewrite');
const { transformInstallContent } = require('./content-transform');

function isMarkdownPath(filePath) {
  return /\.(md|mdx|markdown)$/i.test(String(filePath || ''));
}

// Map every copy-file operation to { sourceRel, destRel } so relative links in
// namespaced markdown can be rewritten to the file's actual installed location
// (issue #2340). Returns null when the plan lacks the data needed to do so.
function buildLinkIndexForPlan(plan) {
  if (!plan || !plan.targetRoot || !Array.isArray(plan.operations)) {
    return null;
  }
  const mappings = [];
  for (const operation of plan.operations) {
    if (operation.kind === 'copy-file' && operation.sourceRelativePath) {
      mappings.push({
        sourceRel: operation.sourceRelativePath,
        destRel: path.relative(plan.targetRoot, operation.destinationPath),
      });
    }
  }
  return buildInstallIndex(mappings);
}

function readJsonObject(filePath, label, readContent = () => fs.readFileSync(filePath, 'utf8')) {
  let parsed;
  try {
    parsed = JSON.parse(readContent());
  } catch (error) {
    const wrappedError = new Error(`Failed to parse ${label} at ${filePath}: ${error.message}`);
    wrappedError.code = error.code;
    throw wrappedError;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid ${label} at ${filePath}: expected a JSON object`);
  }

  return parsed;
}

function readOptionalJsonObject(filePath, label) {
  try {
    return readJsonObject(filePath, label);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

function readInstalledFileNoFollow(plan, operation) {
  assertSafeInstallOperation(plan, operation);
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  let descriptor;
  try {
    descriptor = fs.openSync(operation.destinationPath, flags);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  try {
    const openedStat = fs.fstatSync(descriptor, { bigint: true });
    const finalPathStat = fs.lstatSync(operation.destinationPath, { bigint: true });
    if (finalPathStat.isSymbolicLink() || !finalPathStat.isFile()) {
      return null;
    }
    const identityMatches = openedStat.ino === finalPathStat.ino
      && (!openedStat.dev || !finalPathStat.dev || openedStat.dev === finalPathStat.dev);
    if (!openedStat.isFile() || !identityMatches) {
      throw new Error(
        `Refusing to hash changed install destination: ${operation.destinationPath}`
      );
    }
    // Revalidate the full path after opening. The descriptor pins the file so
    // the digest and metadata refer to the same object.
    assertSafeInstallOperation(plan, operation);
    return fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function stateWithContentDigests(state, plan) {
  const currentDestinations = new Set((plan.operations || [])
    .filter(operation => operation.destinationPath)
    .map(operation => {
      const resolved = path.resolve(operation.destinationPath);
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    }));
  return {
    ...state,
    operations: (state.operations || []).map(operation => {
      if (!operation.destinationPath) {
        return { ...operation };
      }
      const resolved = path.resolve(operation.destinationPath);
      const destinationKey = process.platform === 'win32'
        ? resolved.toLowerCase()
        : resolved;
      if (!currentDestinations.has(destinationKey)) {
        return { ...operation };
      }
      const installedContent = readInstalledFileNoFollow(plan, operation);
      if (installedContent === null) {
        return { ...operation };
      }
      return {
        ...operation,
        contentSha256: crypto.createHash('sha256')
          .update(installedContent)
          .digest('hex'),
      };
    }),
  };
}

function cloneJsonValue(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMergeJson(baseValue, patchValue) {
  if (!isPlainObject(baseValue) || !isPlainObject(patchValue)) {
    return cloneJsonValue(patchValue);
  }

  const merged = { ...baseValue };
  for (const [key, value] of Object.entries(patchValue)) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = deepMergeJson(merged[key], value);
    } else {
      merged[key] = cloneJsonValue(value);
    }
  }
  return merged;
}

function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isMcpConfigPath(filePath) {
  const basename = path.basename(String(filePath || ''));
  return basename === '.mcp.json' || basename === 'mcp.json' || basename === 'mcp_config.json';
}

function getTrustedRootsForPlan(plan) {
  if (!plan) return [];
  if (Array.isArray(plan.trustedRoots) && plan.trustedRoots.length > 0) {
    return plan.trustedRoots;
  }
  return plan.targetRoot ? [plan.targetRoot] : [];
}

function withMcpMergeExclusions(plan, disabledServers) {
  if (disabledServers.length === 0) {
    return plan;
  }
  const filterOperation = operation => (
    operation.kind === 'merge-json' && isMcpConfigPath(operation.destinationPath)
      && isPlainObject(operation.mergePayload)
      && isPlainObject(operation.mergePayload.mcpServers)
      ? {
        ...operation,
        mergePayload: filterMcpConfig(operation.mergePayload, disabledServers).config,
      }
      : operation
  );
  // Writes, recovery checkpoints, and the final ownership ledger must use the
  // same payload. Repair and uninstall later run without the install environment.
  return {
    ...plan,
    operations: plan.operations.map(filterOperation),
    statePreview: {
      ...plan.statePreview,
      operations: plan.statePreview.operations.map(filterOperation),
    },
  };
}

function assertSafeInstallOperation(plan, operation) {
  if (!operation || typeof operation.destinationPath !== 'string') {
    throw new Error('Refusing to apply install operation: missing destination path.');
  }

  const trustedRoots = getTrustedRootsForPlan(plan);
  const matchingRoot = trustedRoots.find(root => isWithinRoot(operation.destinationPath, root));
  const targetRoot = matchingRoot || (plan && plan.targetRoot);
  assertWithinTrustedRoot(operation.destinationPath, targetRoot, 'install ECC file');

  const resolvedRoot = path.resolve(targetRoot);
  const resolvedTarget = path.resolve(operation.destinationPath);
  const relativePath = path.relative(resolvedRoot, resolvedTarget);
  const segments = relativePath ? relativePath.split(path.sep) : [];
  for (const segmentIndex of Array.from({ length: segments.length + 1 }, (_value, index) => index)) {
    const currentPath = segmentIndex === 0
      ? resolvedRoot
      : path.join(resolvedRoot, ...segments.slice(0, segmentIndex));
    try {
      const stats = fs.lstatSync(currentPath);
      if (stats.isSymbolicLink()) {
        throw new Error(
          `Refusing to install ECC file through symlinked path: '${currentPath}'.`
        );
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        break;
      }
      throw error;
    }
  }
}

function readPreviousInstallState(plan) {
  if (!fs.existsSync(plan.installStatePath)) {
    return null;
  }
  return readInstallState(plan.installStatePath);
}

function comparablePath(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function withoutManagedAntigravityHooks(plan, operation) {
  const content = readInstalledFileNoFollow(plan, operation);
  const config = content === null ? {} : JSON.parse(content.toString('utf8'));
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`Invalid Antigravity hooks config: ${operation.destinationPath}`);
  }
  if (Object.hasOwn(config, 'ecc-guard')
    && !isDeepStrictEqual(config['ecc-guard'], operation.mergePayload?.['ecc-guard'])) {
    throw new Error(`Refusing to disable modified Antigravity hooks in ${operation.destinationPath}.`);
  }
  const userHooks = Object.fromEntries(Object.entries(config).filter(([name]) => name !== 'ecc-guard'));
  return {
    content: formatJson(userHooks),
    expectedContent: content === null ? { kind: 'absent' } : {
      kind: 'sha256', digest: crypto.createHash('sha256').update(content).digest('hex'),
    },
  };
}

function prepareAntigravityHookDeactivation(plan, migration, previousState) {
  if (!shouldDisableAntigravityHooks(plan)) return migration;
  const hooksPath = path.join(plan.targetRoot, 'hooks.json');
  const previousHooks = previousState.operations.find(operation => (
    operation.ownership === 'managed' && operation.kind === 'merge-json'
    && operation.moduleId === 'hooks-runtime'
    && comparablePath(operation.destinationPath) === comparablePath(hooksPath)
  ));
  if (!previousHooks) return migration;
  const removal = { ...previousHooks, kind: 'remove-antigravity-hooks' };
  // Check before ordinary writes, then re-read at the guarded write boundary.
  withoutManagedAntigravityHooks(plan, removal);
  const disabledSetup = {
    ...previousHooks,
    kind: 'merge-json',
    destinationPath: path.join(plan.targetRoot, 'ecc', 'setup.json'),
    mergePayload: { hooks: { enabled: false } },
  };
  assertSafeInstallOperation(plan, disabledSetup);
  readOptionalJsonObject(disabledSetup.destinationPath, 'managed hook setup');
  const changed = new Set([hooksPath, disabledSetup.destinationPath].map(comparablePath));
  return {
    ...migration,
    appliedOperations: [
      ...migration.appliedOperations, removal,
      { ...disabledSetup, kind: 'disable-antigravity-hook-setup' },
    ],
    warnings: [...migration.warnings, 'Disabling previously installed Antigravity hooks; preserving user hook namespaces.'],
    finalState: {
      ...migration.finalState,
      operations: [
        ...migration.finalState.operations.filter(operation => !changed.has(comparablePath(operation.destinationPath))),
        { ...previousHooks, mergePayload: {} }, disabledSetup,
      ],
    },
    bridgeState: {
      ...migration.bridgeState,
      request: { ...migration.bridgeState.request, hookConsent: getRecordedHookConsent(previousState) },
    },
    requiresBridgeState: true,
  };
}

function uniqueOperations(operations) {
  const byDestination = new Map();
  for (const operation of operations) {
    if (!operation || !operation.destinationPath) {
      continue;
    }
    byDestination.set(comparablePath(operation.destinationPath), operation);
  }
  return [...byDestination.values()];
}

function prepareInstallMigration(plan) {
  const previousState = fs.existsSync(plan.installStatePath)
    ? readInstallState(plan.installStatePath)
    : null;
  const finalState = {
    ...plan.statePreview,
    operations: uniqueOperations([
      ...((previousState && previousState.operations) || []),
      ...((plan.statePreview && plan.statePreview.operations) || []),
    ]).map(operation => ({ ...operation })),
  };
  return {
    enabled: false,
    appliedOperations: [...plan.operations],
    skippedOperations: [],
    warnings: [],
    bridgeState: finalState,
    finalState,
    legacyOperationsToRemove: [],
    retainedLegacyOperations: [],
    requiresBridgeState: plan.operations.length > 0,
  };
}

function prepareHookConsentMigration(plan, migration) {
  if (plan.hookConsent !== 'declined') {
    return migration;
  }
  const previousState = readPreviousInstallState(plan);
  if (!previousState) {
    return migration;
  }
  if (shouldDisableAntigravityHooks(plan)) {
    return prepareAntigravityHookDeactivation(plan, migration, previousState);
  }
  return migration;
}

function preflightQwenAgentOperations(plan) {
  for (const operation of plan.operations || []) {
    if (operation.kind === 'copy-file' && operation.contentTransform === 'qwen-agent-frontmatter') {
      assertSafeInstallOperation(plan, operation);
      if (!fs.lstatSync(operation.sourcePath).isFile()) {
        throw new Error('Refusing Qwen agent adaptation from a non-regular source file');
      }
      transformInstallContent(operation, fs.readFileSync(operation.sourcePath, 'utf8'));
    }
  }
}

function previewInstallPlan(rawPlan) {
  const plan = withMcpMergeExclusions(rawPlan, parseDisabledMcpServers(process.env.ECC_DISABLED_MCPS));
  preflightQwenAgentOperations(plan);
  const migration = prepareStaleOperationsReconciliation(
    plan,
    prepareHookConsentMigration(
      plan,
      prepareUserOwnedFileGuard(plan, prepareInstallMigration(plan))
    )
  );
  const hookConsentWarnings = planMaterializesHookRuntime(plan) && plan.hookConsent !== 'enabled'
    ? ['Applying this plan requires an explicit hook decision: --enable-hooks or --no-hooks.']
    : [];
  return {
    ...plan,
    statePreview: withoutStaleOperations(migration.finalState, migration),
    plannedOperations: [...plan.operations],
    operations: migration.appliedOperations,
    skippedOperations: migration.skippedOperations,
    warnings: [
      ...(Array.isArray(plan.warnings) ? plan.warnings : []),
      ...migration.warnings,
      ...hookConsentWarnings,
      ...describeStaleOperationsPreview(migration),
    ],
    applied: false,
  };
}

function applyInstallPlan(plan, dependencies = {}) {
  assertHookConsentReady(plan);
  return applyInstallPlanLocked(plan, dependencies);
}

function applyInstallPlanLocked(rawPlan, dependencies = {}) {
  const disabledServers = parseDisabledMcpServers(process.env.ECC_DISABLED_MCPS);
  const plan = withMcpMergeExclusions(rawPlan, disabledServers);
  preflightQwenAgentOperations(plan);
  const persistInstallState = dependencies.writeInstallState || writeInstallState;
  const beforeInstallStateRead = dependencies.beforeInstallStateRead;
  const beforeOperationWrite = dependencies.beforeOperationWrite;
  const beforeInstallStateWrite = dependencies.beforeInstallStateWrite;
  if (typeof beforeInstallStateRead === 'function') {
    beforeInstallStateRead({ plan });
  }
  const migration = prepareStaleOperationsReconciliation(
    plan,
    prepareExcludedPathsReconciliation(
      plan,
      prepareHookConsentMigration(
        plan,
        prepareUserOwnedFileGuard(plan, prepareInstallMigration(plan))
      )
    )
  );
  const appliedPlan = {
    ...plan,
    operations: migration.appliedOperations,
  };
  const linkIndex = buildLinkIndexForPlan(appliedPlan);
  const writtenDestinations = new Set();
    if (migration.requiresBridgeState) {
      // Own every operation that may be written during a flat-skill migration
      // before the first copy. A later failure is retryable and uninstall can
      // clean the entire partial install, including non-skill files. During
      // legacy migration the bridge also retains the prior managed operations.
      if (typeof beforeInstallStateWrite === 'function') {
        beforeInstallStateWrite({ plan: appliedPlan, state: migration.bridgeState });
      }
      persistInstallState(plan.installStatePath, migration.bridgeState);
    }

    let finalState;
    try {
      for (const operation of appliedPlan.operations) {
      assertSafeInstallOperation(appliedPlan, operation);
      fs.mkdirSync(path.dirname(operation.destinationPath), { recursive: true });
      // Recheck directories that were absent during the first validation. This
      // narrows the symlink-swap window around mkdirSync, but path checks cannot
      // eliminate a later TOCTOU race before the file write.
      assertSafeInstallOperation(appliedPlan, operation);
      if (typeof beforeOperationWrite === 'function') {
        beforeOperationWrite({ plan: appliedPlan, operation });
      }
      assertNoNewUserOwnedFile(migration, operation, appliedPlan);

      if (['remove-antigravity-hooks', 'disable-antigravity-hook-setup'].includes(operation.kind)) {
        const current = operation.kind === 'disable-antigravity-hook-setup'
          ? readInstalledFileNoFollow(appliedPlan, operation) : null;
        const disabled = operation.kind === 'remove-antigravity-hooks'
          ? withoutManagedAntigravityHooks(appliedPlan, operation)
          : {
            content: formatJson(deepMergeJson(
              readJsonObject(operation.destinationPath, 'managed hook setup', () => current || '{}'),
              operation.mergePayload
            )),
            expectedContent: current === null ? { kind: 'absent' } : {
              kind: 'sha256', digest: crypto.createHash('sha256').update(current).digest('hex'),
            },
          };
        writeFileNoFollow(operation.destinationPath, disabled.content, {
          action: 'disable Antigravity hooks',
          expectedContent: disabled.expectedContent,
          validateDestination(destinationPath) {
            assertSafeInstallOperation(appliedPlan, { destinationPath });
            return destinationPath;
          },
        });
        writtenDestinations.add(operation.destinationPath);
        continue;
      }

      if (operation.kind === 'merge-json') {
        const payload = cloneJsonValue(operation.mergePayload);
        if (payload === undefined) {
          throw new Error(`Missing merge payload for ${operation.destinationPath}`);
        }

        const currentValue = readOptionalJsonObject(
          operation.destinationPath,
          'existing JSON config'
        );
        const mergedValue = deepMergeJson(currentValue, payload);
        fs.writeFileSync(operation.destinationPath, formatJson(mergedValue), 'utf8');
        writtenDestinations.add(operation.destinationPath);
        continue;
      }

      if (operation.kind === 'copy-file' && isMcpConfigPath(operation.destinationPath) && disabledServers.length > 0) {
        const sourceConfig = readJsonObject(operation.sourcePath, 'MCP config');
        const filteredConfig = filterMcpConfig(sourceConfig, disabledServers).config;
        fs.writeFileSync(operation.destinationPath, formatJson(filteredConfig), 'utf8');
        writtenDestinations.add(operation.destinationPath);
        continue;
      }

      // Declared transforms are part of the install contract and always apply.
      // Markdown link rewriting is additive when the plan has a usable index.
      const needsLinkRewrite = Boolean(
        linkIndex
        && operation.sourceRelativePath
        && isMarkdownPath(operation.destinationPath)
      );
      if (operation.kind === 'copy-file' && (operation.contentTransform || needsLinkRewrite)) {
        const transformed = transformInstallContent(
          operation,
          fs.readFileSync(operation.sourcePath, 'utf8')
        );
        const installedContent = needsLinkRewrite
          ? rewriteRelativeLinks(transformed, {
            sourceRel: operation.sourceRelativePath,
            index: linkIndex,
          })
          : transformed;
        fs.writeFileSync(operation.destinationPath, installedContent, 'utf8');
        writtenDestinations.add(operation.destinationPath);
        continue;
      }

      fs.copyFileSync(operation.sourcePath, operation.destinationPath);
      writtenDestinations.add(operation.destinationPath);
    }

    finalState = stateWithContentDigests(
      withoutStaleOperations(migration.finalState, migration),
      appliedPlan
    );
      if (typeof beforeInstallStateWrite === 'function') {
        beforeInstallStateWrite({ plan: appliedPlan, state: finalState });
      }
      persistInstallState(plan.installStatePath, finalState);
    } catch (error) {
      if (migration.requiresBridgeState) {
        try {
          persistInstallState(
            plan.installStatePath,
            stateWithContentDigests(
              preserveUnwrittenFiles(migration.bridgeState, migration, writtenDestinations),
              {
                ...appliedPlan,
                operations: appliedPlan.operations.filter(operation => (
                  writtenDestinations.has(operation.destinationPath)
                )),
              }
            )
          );
        } catch (checkpointError) {
          throw new Error(
            `${error.message} Install-state checkpoint also failed: ${checkpointError.message}`,
            { cause: error }
          );
        }
      }
      throw error;
    }
    let antigravityMigrationWarnings = [];
  try {
    const antigravityMigration = cleanupLegacyAntigravityInstall(appliedPlan);
    if (antigravityMigration.detected && !antigravityMigration.complete) {
      antigravityMigrationWarnings = [
        'Legacy Antigravity migration is incomplete. ECC preserved modified, unverifiable, or unmanaged content under .agent; review and move anything you want to keep, then rerun the Antigravity install.',
        ...(Array.isArray(antigravityMigration.warnings) ? antigravityMigration.warnings : []),
      ];
    }
  } catch (error) {
    antigravityMigrationWarnings = [
      `Legacy Antigravity cleanup did not finish: ${error.message}. Content under .agent was preserved; remove it manually or rerun the Antigravity install.`,
    ];
  }

  let excludedPathsRemoved = [];
  let excludedPathsWarnings = [];
  try {
    const excludedReconciliation = completeExcludedPathsReconciliation(migration, appliedPlan);
    excludedPathsRemoved = excludedReconciliation.removedPaths;
    excludedPathsWarnings = excludedReconciliation.warnings;
  } catch (error) {
    excludedPathsWarnings = [
      `Excluded-paths reconciliation did not finish: ${error.message}. Previously managed files under excluded source paths were preserved; remove them manually or rerun the install.`,
    ];
  }

  let stalePathsRemoved = [];
  let stalePathsWarnings = [];
  try {
    const staleReconciliation = completeStaleOperationsReconciliation(migration, appliedPlan);
    stalePathsRemoved = staleReconciliation.removedPaths;
    stalePathsWarnings = staleReconciliation.warnings;
  } catch (error) {
    stalePathsWarnings = [
      `Stale install-state reconciliation did not finish: ${error.message}. Files ECC no longer installs were preserved; remove them manually if unwanted.`,
    ];
  }

    return {
      ...plan,
      statePreview: finalState,
      plannedOperations: [...plan.operations],
      operations: migration.appliedOperations,
      skippedOperations: migration.skippedOperations,
      reconciledExcludedPaths: excludedPathsRemoved,
      reconciledStalePaths: stalePathsRemoved,
      warnings: [
        ...(Array.isArray(plan.warnings) ? plan.warnings : []),
        ...migration.warnings,
        ...antigravityMigrationWarnings,
        ...excludedPathsWarnings,
        ...stalePathsWarnings,
      ],
      applied: true,
    };
}

module.exports = {
  applyInstallPlan,
  assertSafeInstallOperation,
  prepareHookConsentMigration,
  previewInstallPlan,
};
