/**
 * Metro 自定义 transformer：将 `.html` 转为 UTF-8 字符串 CJS 模块。
 * 其它扩展仍交给 @react-native/metro-babel-transformer。
 */
const path = require('path');
const upstreamTransformer = require('@react-native/metro-babel-transformer');

module.exports.transform = function transform({src, filename, options}) {
  if (path.extname(filename) === '.html') {
    const code = `module.exports = ${JSON.stringify(src)};`;
    return upstreamTransformer.transform({
      src: code,
      // 交给 babel 时按 JS 解析
      filename: `${filename}.js`,
      options,
    });
  }
  return upstreamTransformer.transform({src, filename, options});
};
