import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

const tsconfigRootDir = import.meta.dirname;

/** Align with eslint.config.base.mjs sharedTsRules (warn on legacy debt). */
const sharedTsRules = {
  "@typescript-eslint/no-unused-vars": "warn",
  "@typescript-eslint/no-explicit-any": "warn",
  "@typescript-eslint/no-require-imports": "off",
};

/**
 * Desktop splits main (tsconfig.json) vs renderer/test (tsconfig.renderer.json).
 * Default projectService only resolves the root tsconfig.json, which omits
 * renderer/test — producing mass "not found by the project service" errors.
 */
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      // preload excluded from tsconfig.json; scripts/fixtures not in TS projects
      "src/preload/**",
      "test/**/*.mjs",
      "test/**/*.js",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  // eslint-disable comments may name react-hooks without the plugin installed
  {
    plugins: {
      "react-hooks": {
        rules: {
          "exhaustive-deps": {
            meta: { schema: [] },
            create: () => ({}),
          },
        },
      },
    },
  },
  {
    files: ["src/**/*.{ts,tsx}", "shared/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir,
      },
    },
    rules: sharedTsRules,
  },
  {
    files: ["renderer/**/*.{ts,tsx}", "test/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.renderer.json",
        tsconfigRootDir,
      },
    },
    rules: sharedTsRules,
  },
  // X1 gate: ban literal @novel-master/core* in renderer only (main/shared/test remain allowed).
  {
    files: ["renderer/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@novel-master/core", "@novel-master/core/*"],
              message:
                "Desktop renderer must not import @novel-master/core; use @shared/logic or @shared instead.",
            },
          ],
        },
      ],
    },
  },
);
