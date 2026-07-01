import { createTsEslintConfig } from "../../eslint.config.base.mjs";
import tseslint from "typescript-eslint";

const tsconfigRootDir = import.meta.dirname;

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
);
