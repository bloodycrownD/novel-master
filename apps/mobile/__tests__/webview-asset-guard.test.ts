/**
 * 四包资产管线**三处手写锚点**的统一守卫（chat-webview-unify cr1-P1-2 / cr2-K-2 /
 * cr2-C-1）：
 *
 * 1. Android 守卫清单：`android/app/build.gradle` 的 checkWebViewAssets packages；
 * 2. iOS 出包守卫清单：`ios/NovelMaster.xcodeproj/project.pbxproj` 里
 *    `Copy WebViewDist into App Bundle` 的 `[ ! -f ... ]` 清单；
 * 3. 消费侧类型镜像：`src/webview-host/webview-asset-uri.ts` 的
 *    `WebViewAssetPackageId` 联合类型。
 *
 * 另有产物面断言：三根产物目录（webview-dist / Android assets / iOS WebViewDist）
 * 里不得存在 PACKAGES 之外的包目录——退役包的历史残留会原样进 APK/IPA
 * （iOS 是整目录 `cp -R` 递归），读侧守卫挡不住产物面。
 *
 * 编码注意：build.gradle 是「UTF-8 + 局部损坏字节」的混合文件（历史上 GBK 转码残留，
 * 部分行含非法 UTF-8 序列与 `&#65533;` 残留）。本测按字节切行、逐行解码，
 * 只取目标行解析——整文件 toString('utf8') 会把损坏字节变成替换字符，导致行号与内容都不可信。
 * pbxproj 则是合法 UTF-8，可直接 readFileSync(..., 'utf8') 全文解码。
 */
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

const BUILD_GRADLE = join(__dirname, '../android/app/build.gradle');
const BUILD_SCRIPT = join(__dirname, '../scripts/build-webview.mjs');
const PBXPROJ = join(__dirname, '../ios/NovelMaster.xcodeproj/project.pbxproj');
const ASSET_URI_SRC = join(
  __dirname,
  '../src/webview-host/webview-asset-uri.ts',
);

/**
 * 与 scripts/build-webview.mjs 的 PACKAGES 同序的四个包 id。
 *
 * transcript-converge 后 chat-transcript 不再是独立包（转录并入 chat-conversation
 * 合成包、旧文档壳退役），故清单从五包改四包。
 */
const EXPECTED_PACKAGES = [
  'rich-document',
  'code-editor',
  'composer-input',
  'chat-conversation',
];

/** iOS 出包阶段名：pbxproj 里那条 shellScript 的就近 name。 */
const IOS_COPY_PHASE_NAME = 'Copy WebViewDist into App Bundle';

/** 三根产物根目录（退役残留会原样进 APK/IPA）。 */
const DIST_ROOTS = [
  join(__dirname, '../webview-dist'),
  join(__dirname, '../android/app/src/main/assets/webview'),
  join(__dirname, '../ios/NovelMaster/WebViewDist'),
];

/** 按字节切行后逐行 UTF-8 解码——只让目标行承担解码风险，损坏行不污染全文。 */
function readLinesByByte(file: string): string[] {
  const buf = readFileSync(file);
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) {
      out.push(buf.subarray(start, i).toString('utf8'));
      start = i + 1;
    }
  }
  out.push(buf.subarray(start).toString('utf8'));
  return out;
}

/** 从 checkWebViewAssets 任务的 doLast 里抠出 packages 数组的元素名。 */
function parseGradlePackages(lines: string[]): string[] {
  const taskAt = lines.findIndex(l => l.includes('checkWebViewAssets'));
  expect(taskAt).toBeGreaterThan(-1);
  const decl = lines
    .slice(taskAt, taskAt + 12)
    .find(l => l.trimStart().startsWith('def packages ='));
  expect(decl).toBeDefined();
  const match = decl!.match(/\[([^\]]*)\]/);
  expect(match).not.toBeNull();
  return Array.from(match![1].matchAll(/"([^"]+)"/g)).map(m => m[1]);
}

/** 从 build-webview.mjs 的 PACKAGES 抠出 id 列表（真源，防 Gradle 清单漂移）。 */
function parseBuildScriptPackages(): string[] {
  const src = readFileSync(BUILD_SCRIPT, 'utf8');
  const block = src.slice(src.indexOf('const PACKAGES = ['));
  return Array.from(block.matchAll(/^\s*id: '([^']+)'/gm)).map(m => m[1]);
}

/**
 * 抠出 pbxproj 里 `name = "Copy WebViewDist into App Bundle"` 那条 shellScript 的
 * 真实脚本文本（pbxproj 是合法 UTF-8，可直接全文解码）。
 *
 * 全文共 5 处 shellScript，按「就近的上一个 name」定位目标条目，避免按下标取。
 * 反转义用 JSON.parse('"' + raw + '"')——pbxproj 的字符串转义与 JSON 同形。
 */
function readIosCopyScript(): string {
  const src = readFileSync(PBXPROJ, 'utf8');
  const matches = [...src.matchAll(/shellScript = "((?:[^"\\]|\\.)*)"/g)];
  expect(matches.length).toBeGreaterThan(0);
  const target = matches.find(m => {
    const before = src.slice(Math.max(0, m.index - 400), m.index);
    const names = [...before.matchAll(/name = "([^"]+)"/g)];
    return names.length > 0 && names[names.length - 1]![1] === IOS_COPY_PHASE_NAME;
  });
  expect(target).toBeDefined();
  return JSON.parse('"' + target![1] + '"') as string;
}

/** 抠出 webview-asset-uri.ts 里 WebViewAssetPackageId 联合类型的成员（消费侧类型镜像）。 */
function parseAssetUriUnionIds(): string[] {
  const src = readFileSync(ASSET_URI_SRC, 'utf8');
  const decl = src.match(
    /export type WebViewAssetPackageId =([\s\S]*?);/,
  );
  expect(decl).not.toBeNull();
  return Array.from(decl![1].matchAll(/'([^']+)'/g)).map(m => m[1]);
}

/**
 * 产物根目录下的包目录名（只列目录；.gitkeep 是文件天然被滤掉）。
 * 目录不存在（未构建）返回空集——没有产物就没有残留，不是失败。
 */
function readDistPackageNames(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, {withFileTypes: true})
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);
}

/** checkWebViewAssets 上方那段 javadoc 注释块（说明守卫语义，注释与代码同源易漂）。 */
function guardComment(lines: string[]): string {
  const taskAt = lines.findIndex(l =>
    l.includes('tasks.register("checkWebViewAssets")'),
  );
  expect(taskAt).toBeGreaterThan(-1);
  const out: string[] = [];
  // 先跨过 javadoc 的 `*/` 收尾行，再往上收到 `/**` 为止。
  for (let i = taskAt - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t === '*/') continue;
    if (t === '/**') break;
    out.unshift(t);
  }
  return out.join('\n');
}

describe('android checkWebViewAssets 守卫清单', () => {
  it('packages 覆盖四包且恰为四项', () => {
    const packages = parseGradlePackages(readLinesByByte(BUILD_GRADLE));
    expect(packages).toEqual(EXPECTED_PACKAGES);
    expect(packages).toHaveLength(4);
  });

  it('漏 chat-conversation 即红——它缺失时守卫会放过白屏 APK', () => {
    const packages = parseGradlePackages(readLinesByByte(BUILD_GRADLE));
    expect(packages).toContain('chat-conversation');
  });

  it('与 build-webview.mjs 的 PACKAGES 零漂移（新增包必须同步守卫清单）', () => {
    const source = parseBuildScriptPackages();
    expect(source).toEqual(EXPECTED_PACKAGES);
    expect(parseGradlePackages(readLinesByByte(BUILD_GRADLE))).toEqual(source);
  });

  it('注释已由「五包」更新为「四包」并列全包名', () => {
    const comment = guardComment(readLinesByByte(BUILD_GRADLE));
    expect(comment).toContain('四包');
    expect(comment).not.toContain('五包');
    for (const pkg of EXPECTED_PACKAGES) {
      expect(comment).toContain(pkg);
    }
  });
});

describe('产物面不得残留退役包目录（cr2-K-2）', () => {
  // 差集口径：正常形态下 names 恰是四包 id，不是空集——别写成 toEqual([])。
  for (const root of DIST_ROOTS) {
    it(`${root.replace(/\\/g, '/')} 下不存在 PACKAGES 之外的包目录`, () => {
      const names = readDistPackageNames(root);
      expect(names.filter(n => !EXPECTED_PACKAGES.includes(n))).toEqual([]);
      expect(new Set(names)).toEqual(new Set(EXPECTED_PACKAGES));
    });
  }
});

describe('iOS pbxproj 出包守卫脚本（cr2-K-1 镜像）', () => {
  it('shellScript 是完整 if 形态：-f 分支恰 4 且以 if [ ! -f 起头', () => {
    const script = readIosCopyScript();
    expect(script).toContain('\nif [ ! -f ');
    expect((script.match(/\[ ! -f /g) ?? []).length).toBe(4);
  });

  it('不含 orphan `]; then`：每个收尾行前面都得有 if 条件（bash -n 语义）', () => {
    const script = readIosCopyScript();
    // pbxproj 里若出现「吃掉了 if 关键字」的形态，`]; then` 会在行首。
    // 逐行检查：含 `]; then` 的行必须以 `if ` 开头。
    for (const line of script.split('\n')) {
      if (line.includes(']; then')) {
        expect(line.trimStart().startsWith('if ')).toBe(true);
      }
    }
    expect(script).not.toMatch(/^\s*\]; then/m);
  });

  it('四包名都列在守卫里', () => {
    const script = readIosCopyScript();
    for (const pkg of EXPECTED_PACKAGES) {
      expect(script).toContain(`$SRC/${pkg}/index.html`);
    }
  });
});

describe('WebViewAssetPackageId 联合类型镜像（cr2-C-1）', () => {
  it('与 PACKAGES 双向相等（不多不少——多一个成员即放行白屏 URI）', () => {
    const union = parseAssetUriUnionIds();
    expect(union).toEqual(EXPECTED_PACKAGES);
    expect(union.filter(id => !EXPECTED_PACKAGES.includes(id))).toEqual([]);
    expect(parseBuildScriptPackages()).toEqual(union);
  });

  it('退役包 chat-transcript 已不在联合类型里', () => {
    expect(parseAssetUriUnionIds()).not.toContain('chat-transcript');
  });
});
