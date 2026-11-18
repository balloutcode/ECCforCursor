'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function mapCursorServer(name, raw, source) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  return {
    name,
    type: typeof raw.type === 'string' ? raw.type : (raw.url ? 'http' : 'stdio'),
    command: typeof raw.command === 'string' ? raw.command : null,
    args: Array.isArray(raw.args) ? raw.args.filter(item => typeof item === 'string') : [],
    url: typeof raw.url === 'string' ? raw.url : null,
    env: raw.env && typeof raw.env === 'object' && !Array.isArray(raw.env) ? raw.env : {},
    enabled: raw.disabled === true ? false : true,
    source
  };
}

function readMcpServersBlock(filePath, scope) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return [];
  }

  const block = parsed && typeof parsed.mcpServers === 'object' && parsed.mcpServers && !Array.isArray(parsed.mcpServers)
    ? parsed.mcpServers
    : {};

  return Object.entries(block)
    .map(([name, raw]) => mapCursorServer(name, raw, {
      harness: 'cursor',
      scope,
      configPath: filePath
    }))
    .filter(Boolean);
}

function uniquePaths(candidates) {
  const seen = new Set();
  const paths = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate.filePath !== 'string' || candidate.filePath.length === 0) {
      continue;
    }
    const resolved = path.resolve(candidate.filePath);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push({ filePath: resolved, scope: candidate.scope });
  }
  return paths;
}

function readCursorMcp(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const projectRoot = options.projectRoot || process.cwd();
  const catalogPaths = Array.isArray(options.catalogPaths)
    ? options.catalogPaths
    : [
      path.join(projectRoot, 'mcp-configs', 'mcp-servers.json'),
      path.join(projectRoot, '.cursor', 'mcp-configs', 'mcp-servers.json')
    ];

  const candidates = uniquePaths([
    { filePath: options.userConfigPath || path.join(homeDir, '.cursor', 'mcp.json'), scope: 'user' },
    { filePath: options.projectConfigPath || path.join(projectRoot, '.cursor', 'mcp.json'), scope: 'project' },
    ...catalogPaths.map(filePath => ({ filePath, scope: 'catalog' }))
  ]);

  return candidates.flatMap(candidate => readMcpServersBlock(candidate.filePath, candidate.scope));
}

module.exports = {
  readCursorMcp,
  mapCursorServer
};
