import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

const sharedTsRules = {
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
