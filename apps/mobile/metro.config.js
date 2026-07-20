/**
 * Monorepo Metro: watch workspace root and resolve hoisted node_modules.
 */
const fs = require('fs');
const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

const monorepoRoot = path.resolve(__dirname, '../..');
const coreDistRoot = path.resolve(monorepoRoot, 'packages/core/dist');
const coreSrcRoot = path.resolve(monorepoRoot, 'packages/core/src');
/** Metro resolves `@novel-master/core` to dist; stale dist misses new domain modules. */
const coreDistSmokeFiles = [
  'index.js',
  'public/chat.js',
  'public/provider.js',
  'domain/events-config/model/events-config.schema.js',
  'domain/compaction-conditions/model/compaction-conditions.schema.js',
  'domain/workplace/logic/default-dir-rule.js',
  'service/events/create-event-orchestrator.js',
  'infra/tokenizer/logic/resolve-context-window.js',
  'infra/tokenizer/logic/count-prompt-llm-input.js',
  'infra/nmtp/logic/registry.js',
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
const coreChatJs = path.join(coreDistRoot, 'public/chat.js');
const coreChatSource = fs.readFileSync(coreChatJs, 'utf8');
if (!coreChatSource.includes('matchUserVfsTurnAt')) {
  throw new Error(
    '[metro] Stale @novel-master/core chat sub-entry (missing matchUserVfsTurnAt). ' +
      'Run: npm run rebuild -w @novel-master/core',
  );
}
const zodRoot = path.resolve(monorepoRoot, 'node_modules/zod');
const tiktokenShim = path.resolve(__dirname, 'src/shims/tiktoken.js');
const awsXmlParserShim = path.resolve(__dirname, 'src/shims/aws-xml-parser.js');
const nodeFsShim = path.resolve(__dirname, 'src/shims/node-fs.js');
const readableStream = require.resolve('readable-stream', {paths: [__dirname]});
const bufferModule = require.resolve('buffer/', {paths: [__dirname]});
/** AWS SDK browser/native builds still import Node built-ins (e.g. node:stream). */
const nodeBuiltinAliases = {
  stream: readableStream,
  buffer: bufferModule,
  fs: nodeFsShim,
  'fs/promises': nodeFsShim,
};
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

const mobileSrcRoot = path.resolve(__dirname, 'src');

/** Mobile `@/` → apps/mobile/src（优先于 core fallback）。 */
function resolveMobilePathAlias(moduleName) {
  if (!moduleName.startsWith('@/')) {
    return null;
  }
  const rel = moduleName.slice(2);
  const withoutExt = rel.replace(/\.(tsx?|jsx?|mjs|cjs)$/, '');
  const candidates = [
    path.join(mobileSrcRoot, rel),
    path.join(mobileSrcRoot, `${withoutExt}.tsx`),
    path.join(mobileSrcRoot, `${withoutExt}.ts`),
    path.join(mobileSrcRoot, `${withoutExt}.jsx`),
    path.join(mobileSrcRoot, `${withoutExt}.js`),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** Core dist keeps TS `@/*` path aliases; Metro must map them to dist (or src) files. */
function resolveCorePathAlias(moduleName) {
  if (!moduleName.startsWith('@/')) {
    return null;
  }
  const rel = moduleName.slice(2);
  const withoutJs = rel.replace(/\.js$/, '');
  const candidates = [
    path.join(coreDistRoot, rel),
    path.join(coreDistRoot, `${withoutJs}.js`),
    path.join(coreSrcRoot, rel),
    path.join(coreSrcRoot, `${withoutJs}.ts`),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveNodeBuiltin(moduleName) {
  const bare = moduleName.startsWith('node:') ? moduleName.slice(5) : moduleName;
  const mapped = nodeBuiltinAliases[bare];
  if (mapped != null && fs.existsSync(mapped)) {
    return mapped;
  }
  return null;
}

/** @aws-sdk/client-* dist-cjs defaults to Node runtimeConfig; RN needs .native. */
function resolveAwsSdkRuntimeConfig(context, moduleName) {
  if (moduleName !== './runtimeConfig' && moduleName !== './runtimeConfig.js') {
    return null;
  }
  const origin = context.originModulePath ?? '';
  if (!origin.includes(`${path.sep}@aws-sdk${path.sep}`)) {
    return null;
  }
  const nativePath = path.join(path.dirname(origin), 'runtimeConfig.native.js');
  if (fs.existsSync(nativePath)) {
    return nativePath;
  }
  return null;
}

/**
 * RN 强制使用 fast-xml-parser shim，避免 browser 版 DOMParser 在 Hermes 上反序列化失败。
 */
function resolveAwsXmlParser(context, moduleName) {
  const origin = context.originModulePath ?? '';

  if (moduleName.includes('xml-parser.browser')) {
    return awsXmlParserShim;
  }

  const relNames = new Set([
    './xml-parser',
    './xml-parser.js',
    './xml-parser.browser',
    './xml-parser.browser.js',
  ]);
  if (
    relNames.has(moduleName) &&
    origin.includes(`${path.sep}@aws-sdk${path.sep}xml-builder${path.sep}`)
  ) {
    return awsXmlParserShim;
  }
  return null;
}

/** @smithy/core/serde 在 RN 下应使用 index.native.js */
function resolveSmithySerdeNative(moduleName) {
  if (moduleName !== '@smithy/core/serde') {
    return null;
  }
  const nativePath = path.join(
    monorepoRoot,
    'node_modules/@smithy/core/dist-cjs/submodules/serde/index.native.js',
  );
  if (fs.existsSync(nativePath)) {
    return nativePath;
  }
  return null;
}

/** Block Node-only tokenizer-driver-node from RN bundles. */
const metroBlockList = [
  /[\\/]packages[\\/]tokenizer-driver-node[\\/]/,
  /[\\/]node_modules[\\/]@agnai[\\/]sentencepiece-js[\\/]/,
  /[\\/]node_modules[\\/]@agnai[\\/]web-tokenizers[\\/]/,
];

/** @type {import('@react-native/metro-config').MetroConfig} */
const config = {
  watchFolders: [monorepoRoot],
  resolver: {
    blockList: metroBlockList,
    assetExts: [...(defaultConfig.resolver.assetExts ?? []), 'model'],
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(monorepoRoot, 'node_modules'),
    ],
    disableHierarchicalLookup: true,
    resolverMainFields: ['react-native', 'browser', 'main'],
    unstable_conditionNames: ['require', 'react-native', 'browser'],
    resolveRequest(context, moduleName, platform) {
      const nodeBuiltinPath = resolveNodeBuiltin(moduleName);
      if (nodeBuiltinPath != null) {
        return {type: 'sourceFile', filePath: nodeBuiltinPath};
      }

      const awsRuntimePath = resolveAwsSdkRuntimeConfig(context, moduleName);
      if (awsRuntimePath != null) {
        return {type: 'sourceFile', filePath: awsRuntimePath};
      }

      const awsXmlParserPath = resolveAwsXmlParser(context, moduleName);
      if (awsXmlParserPath != null) {
        return {type: 'sourceFile', filePath: awsXmlParserPath};
      }

      const smithySerdeNative = resolveSmithySerdeNative(moduleName);
      if (smithySerdeNative != null) {
        return {type: 'sourceFile', filePath: smithySerdeNative};
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

      const mobileAliasPath = resolveMobilePathAlias(moduleName);
      if (mobileAliasPath != null) {
        return {type: 'sourceFile', filePath: mobileAliasPath};
      }

      const coreAliasPath = resolveCorePathAlias(moduleName);
      if (coreAliasPath != null) {
        return {type: 'sourceFile', filePath: coreAliasPath};
      }

      if (defaultResolveRequest != null) {
        return defaultResolveRequest(context, moduleName, platform);
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(defaultConfig, config);
