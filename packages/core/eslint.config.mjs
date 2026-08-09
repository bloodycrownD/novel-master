import { createTsEslintConfig } from "../../eslint.config.base.mjs";
import tseslint from "typescript-eslint";

const tsconfigRootDir = import.meta.dirname;

/**
 * S-5 lint 契约：禁止 public barrel re-export 带 @deprecated JSDoc 标注的符号。
 *
 * 背景是这样的——S-5 wave-2 已经把 deprecated alias 从 public 面清掉了，
 * 但每次新增/恢复 alias 都要靠人眼 review 才能拦住，太脆弱了。所以这里加
 * 一条 lint 规则做永久封堵：只要 src/index.ts 或 src/public 下的 .ts
 * 里出现 @deprecated 的 JSDoc 紧贴 export 块的情况，就直接报 error。
 *
 * 为什么不用 no-restricted-syntax：因为 @deprecated 是 JSDoc 注释里的内容，
 * AST 选择器只能匹配节点属性，没办法读到注释文本，所以这里走内联自定义规则，
 * 直接拿 sourceCode.getCommentsBefore 检查 leading comment 里有没有 @deprecated。
 *
 * 为什么不做跨文件解析（去源模块读 @deprecated）：lint 层跨文件解析成本太高，
 * 而且本轮 S-5 的回归样本（agent.ts 的 resolveApplicationModelId alias）
 * 就是在 barrel 上贴 @deprecated JSDoc，所以「barrel 内出现 @deprecated
 * 注释」这条规则已经能覆盖最常见的复发模式啦。等以后真有跨文件需求再升级。
 */
const noDeprecatedBarrelExportRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "S-5 契约：禁止 public barrel（src/index.ts 与 src/public 下 .ts）re-export 带 @deprecated 标注的符号",
    },
    schema: [],
    messages: {
      deprecatedExport:
        "S-5 契约违规：public barrel（{{file}}）禁止导出带 @deprecated 标注的符号。请直接删除该导出；如果是临时过渡，先迁移下游再撤掉 alias。",
    },
  },
  create(context) {
    // 拿到当前文件的相对路径，报错信息里好读
    const filePath = context.filename || context.getFilename();

    function checkLeadingComments(node) {
      const sourceCode = context.sourceCode ?? context.getSourceCode();
      const comments = sourceCode.getCommentsBefore(node);
      for (const comment of comments) {
        // 只看块注释（JSDoc 也是块注释），且文本里出现 @deprecated 标签
        if (comment.type === "Block" && /@deprecated\b/.test(comment.value)) {
          context.report({
            node,
            messageId: "deprecatedExport",
            data: { file: filePath },
          });
          return;
        }
      }
    }

    return {
      ExportNamedDeclaration(node) {
        checkLeadingComments(node);
      },
      ExportDefaultDeclaration(node) {
        checkLeadingComments(node);
      },
    };
  },
};

export default tseslint.config(
  ...createTsEslintConfig(tsconfigRootDir, {
    testTsconfig: "./tsconfig.test.json",
  }),
  {
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-this-alias": "off",
    },
  },
  // S-5 契约：public barrel 文件禁止 re-export 带 @deprecated 的符号。
  // 这里把规则作用域收紧到 src/index.ts 和 src/public/**/*.ts，
  // 既对得上 spec 的「index.ts / public/*.ts」措辞，也不会误伤 test
  // 和内部模块（它们偶尔会需要保留 @deprecated 做向下兼容）。
  {
    files: ["src/index.ts", "src/public/**/*.ts"],
    plugins: {
      "novel-s5": {
        rules: {
          "no-deprecated-barrel-export": noDeprecatedBarrelExportRule,
        },
      },
    },
    rules: {
      "novel-s5/no-deprecated-barrel-export": "error",
    },
  },
);
