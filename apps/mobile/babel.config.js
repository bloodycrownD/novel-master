module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // Fallback when a dependency still resolves to zod v4 ESM (export * as …).
  plugins: ['@babel/plugin-transform-export-namespace-from'],
};
