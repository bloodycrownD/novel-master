// mobile 的 ESLint 9 flat config。
//
// 之前 mobile 用的是 legacy `.eslintrc.js`，只 extends `@react-native` 一行；
// 升到 ESLint 9 之后那种写法已经被淘汰啦，所以这里改成 flat config 的等价形式。
// 做法上分三块：
//   1. 先 spread `@react-native/eslint-config/flat`——这是 RN 官方提供的 flat 入口，
//      里面已经把 babel parser、react/react-native/jest 这堆插件、还有 prettier
//      兼容规则都配好了，对应原来 extends '@react-native' 的全部行为。
//   2. 把 ft-flow 相关规则摘掉——`@react-native/eslint-config@0.85.3` 锁的是
//      `eslint-plugin-ft-flow@^2.0.1`，但 2.x 用了 ESLint 9 已经删掉的
//      `context.getAllComments`，一加载就崩。mobile 全是 TS、根本没有 flow 文件，
//      摘掉这些规则既不影响实际校验，也能绕开 plugin 兼容坑；等 RN 升级锁了
//      ft-flow 3.x 再放开就行。
//   3. 再追加 sharedTsRules——和 core/cli/desktop 三端拉齐 TS 规则基线，
//      避免 mobile 这边继续自成一套、跟其它包漂移。
//
// 为什么不直接复用根目录的 createTsEslintConfig：那套带 projectService + tsconfig
// 类型感知，对 RN 项目跑起来成本太高、还要单独维护 tsconfig 路径，得不偿失；
// RN 自带的 flat 已经把 typescript parser 配好了，咱们只在 rules 层面拉齐就够。
import reactNativeConfig from "@react-native/eslint-config/flat";
import { sharedTsRules } from "../../eslint.config.base.mjs";

// 把 ft-flow/* 规则从 RN flat 基线里摘掉，原因见上面注释第 2 点。
const withoutFtFlowRules = reactNativeConfig.map((block) => {
  if (!block || !block.rules) return block;
  const pruned = {};
  for (const [name, value] of Object.entries(block.rules)) {
    if (!name.startsWith("ft-flow/")) pruned[name] = value;
  }
  return { ...block, rules: pruned };
});

export default [
  {
    ignores: [
      "node_modules/**",
      "android/**",
      "ios/**",
      "webview-dist/**",
      "dist/**",
      "coverage/**",
    ],
  },

  // RN 官方 flat 基线（等价于原来的 extends: '@react-native'，已剔除 ft-flow 规则）
  ...withoutFtFlowRules,

  // 三端共用 TS 规则基线，覆盖默认 RN 规则里没明确表态的几条 legacy debt
  {
    files: ["**/*.{ts,tsx}"],
    rules: sharedTsRules,
  },

  // oq21/typed-eslint：只对 services/runtime/storage 三个逻辑目录开类型感知
  // lint。RN flat 基线已经注册了 @typescript-eslint 插件和 parser，这里补
  // projectService 让规则拿到类型信息即可。fire-and-forget 的 promise 在 RN
  // 侧非常多（infra/B-2、b2/B-5 就是这个缺口），所以先 warn 锁存量、不阻塞，
  // package.json lint 的 --max-warnings 基线随新增 warn 同步抬高；
  // components/screens 的存量更重，暂缓不开。
  {
    files: [
      'src/services/**/*.{ts,tsx}',
      'src/runtime/**/*.{ts,tsx}',
      'src/storage/**/*.{ts,tsx}',
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',
    },
  },
];
