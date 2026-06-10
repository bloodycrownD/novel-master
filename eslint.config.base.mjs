import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Shared flat ESLint config for TypeScript workspaces (warn on legacy debt).
 */
export function createTsEslintConfig(tsconfigRootDir) {
  return tseslint.config(
    { ignores: ["dist/**", "node_modules/**", "coverage/**"] },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
      },
      rules: {
        "@typescript-eslint/no-unused-vars": "warn",
        "@typescript-eslint/no-explicit-any": "warn",
        "@typescript-eslint/no-require-imports": "off",
      },
    },
  );
}
