/**
 * Jest transformer：将 `.html` 读为 UTF-8 字符串模块（`module.exports = "..."`）。
 * 与 Metro html-file-delivery 主路径对称，便于 `import html from '*.html'`。
 */
module.exports = {
  process(sourceText) {
    return {
      code: `module.exports = ${JSON.stringify(sourceText)};`,
    };
  },
};
