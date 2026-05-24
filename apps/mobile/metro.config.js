/**
 * Monorepo Metro: watch workspace root and resolve hoisted node_modules.
 */
const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

const monorepoRoot = path.resolve(__dirname, '../..');

/** @type {import('@react-native/metro-config').MetroConfig} */
const config = {
  watchFolders: [monorepoRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(monorepoRoot, 'node_modules'),
    ],
    disableHierarchicalLookup: true,
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
