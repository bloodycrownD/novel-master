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
  },
};
