import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * 三端共用的 TS lint 规则基线。
 *
 * 之所以把它单独 export 出来——是因为之前 desktop 的 eslint config 里手抄了
 * 一份一模一样的对象，core/cli 走 createTsEslintConfig 内部又引用了一次，
 * 两边一旦不同步就会出现「这边 warn 那边 error」的漂移。这里改成唯一来源后，
 * desktop/mobile 只需要 import 进来 spread 到对应 files 块的 rules 里就行啦。
 */
export const sharedTsRules = {
  "@typescript-eslint/no-unused-vars": "warn",
  "@typescript-eslint/no-explicit-any": "warn",
  "@typescript-eslint/no-require-imports": "off",
};

/**
 * Shared flat ESLint config for TypeScript workspaces (warn on legacy debt).
 *
 * @param {string} tsconfigRootDir
 * @param {{ testTsconfig?: string }} [options]
 */
export function createTsEslintConfig(tsconfigRootDir, options = {}) {
  const { testTsconfig } = options;
  const srcFiles = testTsconfig ? ["src/**/*.ts"] : ["**/*.{ts,tsx,mjs,cjs,js}"];

  const configs = [
    { ignores: ["dist/**", "node_modules/**", "coverage/**"] },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
      files: srcFiles,
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
      },
      rules: sharedTsRules,
    },
  ];

  if (testTsconfig) {
    configs.push({
      files: ["test/**/*.ts"],
      languageOptions: {
        parserOptions: {
          project: testTsconfig,
          tsconfigRootDir,
        },
      },
      rules: sharedTsRules,
    });
  }

  return tseslint.config(...configs);
}
