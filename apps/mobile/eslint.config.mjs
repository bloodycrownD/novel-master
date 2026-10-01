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
import reactNativeConfig from '@react-native/eslint-config/flat';
import {sharedTsRules} from '../../eslint.config.base.mjs';

/**
 * X3 门 A：WebView 老浏览器构造守卫（wave-e X3.2）。
 *
 * 为什么要这道门：`composer-input` 的 WebView bundle 曾经在 IIFE 顶层执行
 * `Object.fromEntries`。那是 Chrome 73+ 的东西，而 minSdkVersion=26 对应
 * Chromium 58 ⇒ 旧 WebView 直接 TypeError，编辑器不挂载、ready 不上报，
 * 宿主等不到握手 ⇒ chat 内联输入框白屏级无响应。源码面上完全看不出来
 * （入口只 import 了一个常量数组），所以必须上机器门禁。
 *
 * 为什么规则分「内置三条 + 自定义一条」：
 *   内置 no-restricted-properties / no-restricted-syntax 覆盖绝大多数直白写法，
 *   自定义规则只补它们表达不了的形态——计算属性（`Object['fromEntries']`）、
 *   可选调用（`x?.at?.()`）、解构取引用（`const {at} = arr`）、以及裸标识符
 *   `structuredClone(...)`。两套规则的覆盖面是互补的，不重复报同一条。
 *
 * ⚠️ 门 A 只作用在**一方源码面**，三处它看不见（这是它的边界，不是缺陷）：
 *   ① `packages/core/dist`（N-P0-01 病灶 builtin-providers.js 就在那儿）→ 门 B 对住；
 *   ② `node_modules` 第三方库 → 门 C 对住；
 *   ③ `src/web/tsconfig.json` 的 `lib: ES2018` 在编译期已经拦掉 5 个构造中的 4 个
 *      （`structuredClone` 声明在 lib.dom.d.ts 里，`lib:ES2018` 拦不住）
 *      ——所以门 A 的净增量 = `structuredClone` + 非类型检查路径（.js/.mjs）。
 *   门 A 的独立价值在于报错信息直指「WebView 老浏览器」语境，且覆盖非 tsc 路径。
 */
const WEBVIEW_RUNTIME_NOTE =
  'WebView 运行在 minSdk 26 / Chromium 58，只按老浏览器环境写（RULE：mobile webview 改动是三层产物链：src/web → build-webview.mjs → webview-dist）。';

/** 计算属性写法要拦的属性名 → 建议替代写法。 */
const WEBVIEW_RESTRICTED_MEMBERS = {
  fromEntries: 'Object.fromEntries（ES2019）',
  hasOwn: 'Object.hasOwn（ES2022）',
  structuredClone: 'structuredClone（Chrome 98）',
  at: 'Array.prototype.at（ES2022）',
  replaceAll: 'String.prototype.replaceAll（ES2021）',
};

/** 解构 / 裸引用形态要拦的全局名。 */
const WEBVIEW_RESTRICTED_GLOBALS = new Set([
  'structuredClone',
  'queueMicrotask',
]);

const noEs2020BuiltinRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'WebView 老浏览器守卫：禁止 ES2019+ 的运行时构造（含计算属性/可选调用/解构/裸引用形态）',
    },
    schema: [],
    messages: {
      restrictedMember:
        'WebView 禁用的运行时构造：{{what}}。{{hint}}。' + WEBVIEW_RUNTIME_NOTE,
      restrictedGlobal:
        'WebView 禁用的全局函数：{{name}}。' + WEBVIEW_RUNTIME_NOTE,
    },
  },
  create(context) {
    /** 文件里是否自己声明/导入了同名绑定（局部遮蔽 ⇒ 不是 WebView 内建用法）。 */
    const shadowed = new Set();
    return {
      // 收集所有本地绑定名：函数参数、变量声明、解构模式、import 局部名。
      ':function': node => {
        for (const param of node.params) collectPatternNames(param, shadowed);
      },
      VariableDeclarator(node) {
        collectPatternNames(node.id, shadowed);
        if (node.init?.type === 'Identifier') {
          shadowed.add(node.init.name);
        }
      },
      ImportDeclaration(node) {
        for (const spec of node.specifiers) shadowed.add(spec.local.name);
      },
      FunctionDeclaration(node) {
        if (node.id) shadowed.add(node.id.name);
      },
      ClassDeclaration(node) {
        if (node.id) shadowed.add(node.id.name);
      },

      // 形态 1：`Object['fromEntries']` / `x?.['at']` / `x['at']?.()`
      'MemberExpression[computed=true]'(node) {
        const key = staticKeyName(node.property);
        if (!key) return;
        if (!(key in WEBVIEW_RESTRICTED_MEMBERS)) return;
        // Object.x 已由内置 no-restricted-properties 覆盖，这里只补计算属性形态，
        // 避免同一条违规报两次。
        if (node.object.type === 'Identifier' && node.object.name === 'Object' &&
            !node.computed) return;
        context.report({
          node,
          messageId: 'restrictedMember',
          data: {what: WEBVIEW_RESTRICTED_MEMBERS[key], hint: '改用 Object.keys/forEach 手工组装'},
        });
      },

      // 形态 2：可选调用 `x?.at?.()` 的 callee 是 MemberExpression，property 非 computed，
      // 内置 no-restricted-syntax 的 `CallExpression > MemberExpression` 选择器要求
      // member 紧贴 call，optional 链会漏。这里单独兜。
      'CallExpression[optional=true]'(node) {
        let callee = node.callee;
        if (callee.type === 'ChainExpression') callee = callee.expression;
        if (callee.type !== 'MemberExpression' || callee.computed) return;
        const key = staticKeyName(callee.property) ?? callee.property.name;
        if (key === undefined) return;
        const isRestrictedMember = key in WEBVIEW_RESTRICTED_MEMBERS;
        const objectIsObject = callee.object.type === 'Identifier' && callee.object.name === 'Object';
        if (!isRestrictedMember || (objectIsObject && key !== 'at' && key !== 'replaceAll')) return;
        context.report({
          node,
          messageId: 'restrictedMember',
          data: {what: WEBVIEW_RESTRICTED_MEMBERS[key], hint: '改用老浏览器等价写法'},
        });
      },

      // 形态 3：裸全局函数引用 / 调用 `structuredClone(x)`。
      // `Object.fromEntries` 这类已经被 MemberExpression 形态覆盖，不重复。
      'Identifier[name=/^(structuredClone|queueMicrotask)$/]'(node) {
        const name = node.name;
        if (shadowed.has(name)) return;
        const parent = node.parent;
        // 属性名位置（`foo.structuredClone`）不算裸引用；已由上面的 MemberExpression 处理。
        if (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) return;
        if (parent?.type === 'Property' && parent.key === node && !parent.computed) return;
        context.report({
          node,
          messageId: 'restrictedGlobal',
          data: {name},
        });
      },
    };
  },
};

function staticKeyName(property) {
  if (!property) return undefined;
  if (property.type === 'Literal' && typeof property.value === 'string') {
    return property.value;
  }
  if (property.type === 'Identifier') return property.name;
  if (property.type === 'TemplateLiteral' && property.expressions.length === 0) {
    return property.quasis[0]?.value.cooked;
  }
  return undefined;
}

function collectPatternNames(pattern, sink) {
  if (!pattern) return;
  switch (pattern.type) {
    case 'Identifier':
      sink.add(pattern.name);
      return;
    case 'ObjectPattern':
      for (const prop of pattern.properties) {
        collectPatternNames(prop.type === 'Property' ? prop.value : prop.argument, sink);
      }
      return;
    case 'ArrayPattern':
      for (const el of pattern.elements) collectPatternNames(el, sink);
      return;
    case 'AssignmentPattern':
      collectPatternNames(pattern.left, sink);
      return;
    case 'RestElement':
      collectPatternNames(pattern.argument, sink);
      return;
    default:
  }
}

// 把 ft-flow/* 规则从 RN flat 基线里摘掉，原因见上面注释第 2 点。
const withoutFtFlowRules = reactNativeConfig.map(block => {
  if (!block || !block.rules) return block;
  const pruned = {};
  for (const [name, value] of Object.entries(block.rules)) {
    if (!name.startsWith('ft-flow/')) pruned[name] = value;
  }
  return {...block, rules: pruned};
});

export default [
  {
    ignores: [
      'node_modules/**',
      'android/**',
      'ios/**',
      'webview-dist/**',
      'dist/**',
      'coverage/**',
    ],
  },

  // RN 官方 flat 基线（等价于原来的 extends: '@react-native'，已剔除 ft-flow 规则）
  ...withoutFtFlowRules,

  // 三端共用 TS 规则基线，覆盖默认 RN 规则里没明确表态的几条 legacy debt
  {
    files: ['**/*.{ts,tsx}'],
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

  // X3 门 A：WebView 老浏览器构造守卫（详见文件上方 noEs2020BuiltinRule 的注释）。
  //
  // ⚠️ 第三个 glob `src/components/**` 不是随手加的：按 esbuild metafile 的一方输入归因，
  // `composer-input` 包里 9 个 first-party inputs 有 3 个落在 `src/components/**`
  // （components/agent/prompt-macro-input.ts、components/chat/composer-highlight.ts、
  // components/common/atomic-range-delete.ts），`code-editor` 包里也有 1 个
  // （components/chat/composer-highlight.ts）。N-P0-01 的病根链
  // prompt-macro-input.ts 就在这一层，只扫 src/web + src/webview-host 的门 A
  // 对原 P0 完全失明。
  //
  // 净增量说明（别把 4/5 构造算成门 A 的功劳）：src/web/tsconfig.json 的 `lib: ES2018`
  // 已经在编译期拦掉 Object.fromEntries / Array.prototype.at / String.prototype.replaceAll /
  // Object.hasOwn 四个；门 A 的净增量 = structuredClone（声明在 lib.dom.d.ts，lib:ES2018 拦不住）
  // + 非类型检查路径（.js/.mjs、任何不参与 tsc 的代码）+ 覆盖 node_modules 之外的
  // packages/core 之外的**我方**全部源码。core dist 与第三方库由门 B / 门 C 对住。
  {
    files: [
      'src/web/**/*.{ts,tsx}',
      'src/webview-host/**/*.{ts,tsx}',
      'src/components/**/*.{ts,tsx}',
    ],
    plugins: {
      'novel-webview': {
        rules: {
          'no-es2020-builtin': noEs2020BuiltinRule,
        },
      },
    },
    rules: {
      'no-restricted-properties': [
        'error',
        {object: 'Object', property: 'fromEntries', message: WEBVIEW_RUNTIME_NOTE},
        {object: 'Object', property: 'hasOwn', message: WEBVIEW_RUNTIME_NOTE},
        // 裸全局 `structuredClone(x)` 走 ESLint 8 的 no-restricted-properties 抓不到
        // （该版本的 schema 只认 {object, property} 形态，认不了「全局变量名」），
        // 由下面的 novel-webview/no-es2020-builtin 兜住。
        {property: 'structuredClone', message: WEBVIEW_RUNTIME_NOTE},
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.object.type!='Super'][callee.property.name='at']",
          message: `Array.prototype.at（ES2022）在 minSdk 26 / Chromium 58 上不存在。${WEBVIEW_RUNTIME_NOTE}`,
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.object.type!='Super'][callee.property.name='replaceAll']",
          message: `String.prototype.replaceAll（ES2021）在 minSdk 26 / Chromium 58 上不存在。${WEBVIEW_RUNTIME_NOTE}`,
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.object.name='Object'][callee.property.name='fromEntries']",
          message: `Object.fromEntries（ES2019）在 minSdk 26 / Chromium 58 上不存在。${WEBVIEW_RUNTIME_NOTE}`,
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.object.name='Object'][callee.property.name='hasOwn']",
          message: `Object.hasOwn（ES2022）在 minSdk 26 / Chromium 58 上不存在。${WEBVIEW_RUNTIME_NOTE}`,
        },
      ],
      'novel-webview/no-es2020-builtin': 'error',
    },
  },
];
