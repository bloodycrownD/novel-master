/**
 * Monorepo Metro: watch workspace root and resolve hoisted node_modules.
 */
const fs = require('fs');
const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

const monorepoRoot = path.resolve(__dirname, '../..');
const zodRoot = path.resolve(monorepoRoot, 'node_modules/zod');
const tiktokenShim = path.resolve(__dirname, 'src/shims/tiktoken.js');
const zodCjs = path.resolve(zodRoot, 'index.cjs');
/** markdown-it@10 pins entities@2; hoisted entities@4 lacks lib/maps/entities.json */
const markdownEntitiesJson = path.resolve(
  monorepoRoot,
  'node_modules/markdown-it/node_modules/entities/lib/maps/entities.json',
);

const defaultConfig = getDefaultConfig(__dirname);
const defaultResolveRequest = defaultConfig.resolver.resolveRequest;

function isTiktokenModule(moduleName) {
  return moduleName === 'tiktoken' || moduleName.startsWith('tiktoken/');
}

/** Prefer zod's precompiled CJS build (Metro cannot parse zod v4 ESM). */
function resolveZodModule(moduleName) {
  if (moduleName === 'zod') {
    return zodCjs;
  }
  if (!moduleName.startsWith('zod/')) {
    return null;
  }

  const rel = moduleName.slice('zod/'.length);
  const withoutExt = rel.replace(/\.(js|mjs|cjs)$/, '');
  const candidates = [
    path.resolve(zodRoot, `${withoutExt}.cjs`),
    path.resolve(zodRoot, `${rel}.cjs`),
    path.resolve(zodRoot, rel),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** @type {import('@react-native/metro-config').MetroConfig} */
const config = {
  watchFolders: [monorepoRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(monorepoRoot, 'node_modules'),
    ],
    disableHierarchicalLookup: true,
    resolverMainFields: ['react-native', 'browser', 'main'],
    unstable_conditionNames: ['require', 'react-native', 'browser'],
    resolveRequest(context, moduleName, platform) {
      if (isTiktokenModule(moduleName)) {
        return {type: 'sourceFile', filePath: tiktokenShim};
      }

      const zodPath = resolveZodModule(moduleName);
      if (zodPath != null) {
        return {type: 'sourceFile', filePath: zodPath};
      }

      if (
        moduleName === 'entities/lib/maps/entities.json' &&
        fs.existsSync(markdownEntitiesJson)
      ) {
        return {type: 'sourceFile', filePath: markdownEntitiesJson};
      }

      if (defaultResolveRequest != null) {
        return defaultResolveRequest(context, moduleName, platform);
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(defaultConfig, config);
