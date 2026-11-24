module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // Fallback when a dependency still resolves to zod v4 ESM (export * as …).
  // worklets/plugin（reanimated/plugin 的转发目标）必须放在 plugins 最后一项。
  plugins: [
    '@babel/plugin-transform-export-namespace-from',
    // @modelcontextprotocol/client 的 dist 产物带 class static block，RN preset 解析不了该语法。
    '@babel/plugin-transform-class-static-block',
    'react-native-worklets/plugin',
  ],
};
