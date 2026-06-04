/**
 * Monorepo Metro: watch workspace root and resolve hoisted node_modules.
 */
const fs = require('fs');
const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

const monorepoRoot = path.resolve(__dirname, '../..');
const coreDistRoot = path.resolve(monorepoRoot, 'packages/core/dist');
/** Metro resolves `@novel-master/core` to dist; stale dist misses new domain modules. */
const coreDistSmokeFiles = [
  'index.js',
  'domain/events-config/model/events-config.schema.js',
  'domain/compaction-conditions/model/compaction-conditions.schema.js',
  'domain/worktree/logic/default-dir-rule.js',
  'service/events/create-event-orchestrator.js',
  'infra/tokenizer/logic/resolve-context-window.js',
  'infra/tokenizer/logic/count-prompt-llm-input.js',
  'infra/tokenizer/impl/get-tokenizer-loader.js',
  'infra/tokenizer/impl/tokenizer-loader-shared.js',
  'service/compaction-conditions/create-compaction-condition-evaluator.js',
];
for (const rel of coreDistSmokeFiles) {
  const abs = path.join(coreDistRoot, rel);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `[metro] Incomplete @novel-master/core build (missing ${rel}). ` +
        'Run: npm run build -w @novel-master/core',
    );
  }
}
const zodRoot = path.resolve(monorepoRoot, 'node_modules/zod');
const tiktokenShim = path.resolve(__dirname, 'src/shims/tiktoken.js');
/** Node-only fallback in core; RN always uses PromptTokenCounterBridge from polyfills. */
const nodeCountPromptStub = path.resolve(
  __dirname,
  'src/shims/count-prompt-llm-input-node.stub.js',
);
const zodCjs = path.resolve(zodRoot, 'index.cjs');
/** markdown-it@10 pins entities@2; hoisted entities@4 lacks lib/maps/entities.json */
const entitiesDecode = path.resolve(
  monorepoRoot,
  'node_modules/entities/lib/decode.js',
);
const entitiesDecodeCodepoint = path.resolve(
  monorepoRoot,
  'node_modules/entities/lib/decode_codepoint.js',
);
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

/**
 * Block Node-only tokenizer paths and @agnai/* — RN uses js-tiktoken + heuristic (M0)
 * or Android native bridge (M1), never web-tokenizers / sentencepiece-js in JS.
 */
const metroBlockList = [
  /[\\/]packages[\\/]core[\\/]dist[\\/]infra[\\/]tokenizer[\\/]impl[\\/]node-tokenizer-loader\.js$/,
  /[\\/]packages[\\/]core[\\/]dist[\\/]infra[\\/]tokenizer[\\/]impl[\\/]create-tokenizer-loader\.js$/,
  /[\\/]packages[\\/]core[\\/]dist[\\/]infra[\\/]tokenizer[\\/]impl[\\/]sentencepiece-token-counter\.js$/,
  /[\\/]packages[\\/]core[\\/]dist[\\/]infra[\\/]tokenizer[\\/]impl[\\/]web-tokenizer-counter\.js$/,
  /[\\/]packages[\\/]core[\\/]dist[\\/]infra[\\/]tokenizer[\\/]logic[\\/]count-prompt-llm-input-node\.js$/,
  /[\\/]node_modules[\\/]@agnai[\\/]sentencepiece-js[\\/]/,
  /[\\/]node_modules[\\/]@agnai[\\/]web-tokenizers[\\/]/,
];

/** @type {import('@react-native/metro-config').MetroConfig} */
const config = {
  watchFolders: [monorepoRoot],
  resolver: {
    blockList: metroBlockList,
    assetExts: [...defaultConfig.resolver.assetExts, 'model'],
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(monorepoRoot, 'node_modules'),
    ],
    disableHierarchicalLookup: true,
    resolverMainFields: ['react-native', 'browser', 'main'],
    unstable_conditionNames: ['require', 'react-native', 'browser'],
    resolveRequest(context, moduleName, platform) {
      if (
        moduleName === './count-prompt-llm-input-node.js' ||
        moduleName.endsWith('count-prompt-llm-input-node.js')
      ) {
        return {type: 'sourceFile', filePath: nodeCountPromptStub};
      }

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

      if (moduleName === 'entities/lib/decode' && fs.existsSync(entitiesDecode)) {
        return {type: 'sourceFile', filePath: entitiesDecode};
      }
      if (
        moduleName === 'entities/lib/decode_codepoint' &&
        fs.existsSync(entitiesDecodeCodepoint)
      ) {
        return {type: 'sourceFile', filePath: entitiesDecodeCodepoint};
      }

      if (defaultResolveRequest != null) {
        return defaultResolveRequest(context, moduleName, platform);
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
  transformer: {
    ...defaultConfig.transformer,
    assetRegistryPath: defaultConfig.transformer?.assetRegistryPath,
  },
};

module.exports = mergeConfig(defaultConfig, config);
