/**
 * Jest: map workspace packages to built dist for unit tests.
 */
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');

module.exports = {
  preset: '@react-native/jest-preset',
  moduleNameMapper: {
    '^@novel-master/core$': path.join(
      repoRoot,
      'packages/core/dist/index.js',
    ),
    '^@novel-master/tdbc-driver-rn/native$': path.join(
      repoRoot,
      'packages/tdbc-driver-rn/dist/native.js',
    ),
    '^@novel-master/tdbc-driver-rn$': path.join(
      repoRoot,
      'packages/tdbc-driver-rn/dist/index.js',
    ),
  },
};
