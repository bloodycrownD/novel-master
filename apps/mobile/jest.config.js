/**
 * Jest: map workspace packages to built dist for unit tests.
 */
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');

module.exports = {
  preset: '@react-native/jest-preset',
  // @noble/hashes v2 为纯 ESM；须经 babel-jest，否则 Jest 报 Cannot use import statement
  // sanitize-html@2.17 嵌套依赖 htmlparser2@12（ESM-only），其 domhandler/domutils/
  // dom-serializer/domelementtype/entities 全家同为 ESM，须一并纳入 babel transform；
  // 嵌套路径 node_modules/sanitize-html/node_modules/htmlparser2 的每层 node_modules
  // 都要能命中白名单，否则该层仍会被忽略并按 CJS require 报错。
  transformIgnorePatterns: [
    // @react-navigation 系列发布 ESM（module 字段）；RichDocumentWebView
    // 自注册 BackHandler 引入 useFocusEffect 后须纳入 babel transform
    'node_modules/(?!((jest-)?react-native|@react-native(-community|-documents)?|@react-navigation|@noble/hashes|sanitize-html|htmlparser2|domhandler|domutils|dom-serializer|domelementtype|entities|react-native-blob-util|@op-engineering)/)',
  ],
  // __tests__/helpers 下是测试辅助函数（如 read-webview-dist），不是测试套件，
  // 别让 Jest 当测试跑而报 "must contain at least one test"。
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/__tests__/helpers/'],
  // coverage 可见性（tests/G-6）：仅报告逻辑层目录，不设阈值门槛，
  // `jest --coverage` 出报告即可、不阻塞流水线。
  collectCoverageFrom: [
    'src/services/**',
    'src/storage/**',
    'src/hooks/**',
    'src/runtime/**',
  ],

  moduleNameMapper: {
    '^react-native-reanimated$':
      '<rootDir>/test-utils/react-native-reanimated-mock.tsx',
    '^react-native-keyboard-controller$':
      '<rootDir>/test-utils/react-native-keyboard-controller-mock.tsx',
    '^react-native-webview$':
      '<rootDir>/test-utils/react-native-webview-mock.tsx',
    // 原生包在 Jest 环境顶层即抛错（blob-util 的 NativeEventEmitter / op-sqlite 的
    // turbo module），挂全局 stub 保证未被局部 mock 的套件也能加载；
    // 测试文件内的 jest.mock 仍会覆盖这里的映射。
    '^react-native-blob-util$':
      '<rootDir>/test-utils/react-native-blob-util-mock.ts',
    '^@op-engineering/op-sqlite$': '<rootDir>/test-utils/op-sqlite-mock.ts',
    '^@react-native-documents/picker$':
      '<rootDir>/test-utils/document-picker-mock.ts',
    '^tiktoken$': '<rootDir>/src/shims/tiktoken.js',
    // RN Jest resolves package "browser"/"default" exports; yaml's browser entry
    // is ESM and breaks. Force the Node CJS build (also needed once core/vfs
    // re-exports character-card which imports stringify-text → yaml).
    '^yaml$': path.join(repoRoot, 'node_modules/yaml/dist/index.js'),
    // Avoid importing `@novel-master/core` barrel in tests: it pulls in the
    // prompt-yaml module which depends on `yaml` ESM browser entry and breaks
    // under the default RN Jest transform settings.
    '^@novel-master/core$': '<rootDir>/test-utils/core-shim.ts',
    '^@novel-master/core/chat$': path.join(
      repoRoot,
      'packages/core/dist/public/chat.js',
    ),
    '^@novel-master/core/common$': path.join(
      repoRoot,
      'packages/core/dist/common/index.js',
    ),
    // tsconfig paths 里 @web/* 指向 src/web/*（WebView 运行时源码），Jest 需同样映射。
    '^@web/(.*)$': '<rootDir>/src/web/$1',
    '^@novel-master/core/regex$': path.join(
      repoRoot,
      'packages/core/dist/public/regex.js',
    ),
    '^@novel-master/core/agent$': path.join(
      repoRoot,
      'packages/core/dist/public/agent.js',
    ),
    '^@novel-master/core/format$': path.join(
      repoRoot,
      'packages/core/dist/public/format.js',
    ),
    '^@novel-master/core/events$': path.join(
      repoRoot,
      'packages/core/dist/public/events.js',
    ),
    '^@novel-master/core/compaction$': path.join(
      repoRoot,
      'packages/core/dist/public/compaction.js',
    ),
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@novel-master/core/workplace$': path.join(
      repoRoot,
      'packages/core/dist/public/workplace.js',
    ),
    '^@novel-master/core/feature-flags$': path.join(
      repoRoot,
      'packages/core/dist/public/feature-flags.js',
    ),
    '^@novel-master/core/vfs$': path.join(
      repoRoot,
      'packages/core/dist/public/vfs.js',
    ),
    '^@novel-master/core/nmtp$': path.join(
      repoRoot,
      'packages/core/dist/infra/nmtp/index.js',
    ),
    '^@novel-master/core/sksp$': path.join(
      repoRoot,
      'packages/core/dist/infra/sksp/index.js',
    ),
    '^@novel-master/core/kkv$': path.join(
      repoRoot,
      'packages/core/dist/public/kkv.js',
    ),
    '^@novel-master/core/message-checkpoint$': path.join(
      repoRoot,
      'packages/core/dist/public/message-checkpoint.js',
    ),
    '^@novel-master/core/session-kkv$': path.join(
      repoRoot,
      'packages/core/dist/public/session-kkv.js',
    ),
    '^@novel-master/core/tdbc$': path.join(
      repoRoot,
      'packages/core/dist/infra/tdbc/index.js',
    ),
    '^@novel-master/sksp-android$': path.join(
      repoRoot,
      'packages/sksp-android/dist/index.js',
    ),
    '^@novel-master/tdbc-driver-rn/native$': path.join(
      repoRoot,
      'packages/tdbc-driver-rn/dist/native.js',
    ),
    '^@novel-master/tdbc-driver-rn$': path.join(
      repoRoot,
      'packages/tdbc-driver-rn/dist/index.js',
    ),
    '^@novel-master/tdbc-driver-op-sqlite/native$': path.join(
      repoRoot,
      'packages/tdbc-driver-op-sqlite/dist/native.js',
    ),
    '^@novel-master/tdbc-driver-op-sqlite$': path.join(
      repoRoot,
      'packages/tdbc-driver-op-sqlite/dist/index.js',
    ),
    '^@novel-master/tokenizer-driver-rn/native$': path.join(
      repoRoot,
      'packages/tokenizer-driver-rn/dist/native.js',
    ),
    '^@novel-master/tokenizer-driver-rn/android-native-bridge$': path.join(
      repoRoot,
      'packages/tokenizer-driver-rn/dist/android-native-bridge.js',
    ),
    '^@novel-master/tokenizer-driver-rn$': path.join(
      repoRoot,
      'packages/tokenizer-driver-rn/dist/index.js',
    ),
    '^@novel-master/core/config-forms/shared$': path.join(
      repoRoot,
      'packages/core/dist/config-forms/shared/index.js',
    ),
    '^@novel-master/core/config-forms/events$': path.join(
      repoRoot,
      'packages/core/dist/config-forms/events/index.js',
    ),
    '^@novel-master/core/config-forms/agent$': path.join(
      repoRoot,
      'packages/core/dist/config-forms/agent/index.js',
    ),
    '^@novel-master/core/config-forms/stored-config-validity$': path.join(
      repoRoot,
      'packages/core/dist/config-forms/stored-config-validity/index.js',
    ),
    '^@novel-master/core/session-fs$': path.join(
      repoRoot,
      'packages/core/dist/public/session-fs.js',
    ),
    '^@novel-master/core/prompt$': path.join(
      repoRoot,
      'packages/core/dist/public/prompt.js',
    ),
    '^@novel-master/core/provider$': path.join(
      repoRoot,
      'packages/core/dist/public/provider.js',
    ),
    '^@novel-master/core/config-forms$': path.join(
      repoRoot,
      'packages/core/dist/config-forms/index.js',
    ),
    '^@novel-master/cloud-sync-driver-s3$': path.join(
      repoRoot,
      'packages/cloud-sync-driver-s3/dist/index.js',
    ),
  },
};
