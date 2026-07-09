/**
 * Jest: map workspace packages to built dist for unit tests.
 */
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');

module.exports = {
  preset: '@react-native/jest-preset',
  moduleNameMapper: {
    '^react-native-webview$': '<rootDir>/test-utils/react-native-webview-mock.tsx',
    '^tiktoken$': '<rootDir>/src/shims/tiktoken.js',
    // Avoid importing `@novel-master/core` barrel in tests: it pulls in the
    // prompt-yaml module which depends on `yaml` ESM browser entry and breaks
    // under the default RN Jest transform settings.
    '^@novel-master/core$': '<rootDir>/test-utils/core-shim.ts',
    '^@novel-master/core/chat$': path.join(
      repoRoot,
      'packages/core/dist/public/chat.js',
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
  '^@/(.*)$': '<rootDir>/src/$1',
    '^@novel-master/core/worktree$': path.join(
      repoRoot,
      'packages/core/dist/public/worktree.js',
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
    '^@novel-master/tdbc-driver-rn/native$': path.join(
      repoRoot,
      'packages/tdbc-driver-rn/dist/native.js',
    ),
    '^@novel-master/tdbc-driver-rn$': path.join(
      repoRoot,
      'packages/tdbc-driver-rn/dist/index.js',
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
