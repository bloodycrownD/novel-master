/**
 * T-AND-GUARD：Android checkWebViewAssets 守卫清单与 build-webview.mjs 的 PACKAGES 对齐
 * （chat-webview-unify cr1-P1-2）。
 *
 * 根因：合成包 chat-conversation 加入后，Android 侧 preBuild 守卫仍只列四包，
 * 干净 clone 出包缺资产、且守卫不响 → APK 白屏 net::ERR_FILE_NOT_FOUND。
 * iOS pbxproj 与 copyDistToNativeSinks 已自动覆盖，此处只锁 build.gradle 这一处手写清单。
 *
 * 编码注意：build.gradle 是「UTF-8 + 局部损坏字节」的混合文件（历史上 GBK 转码残留，
 * 部分行含非法 UTF-8 序列与 `&#65533;` 残留）。本测按字节切行、逐行解码，
 * 只取目标行解析——整文件 toString('utf8') 会把损坏字节变成替换字符，导致行号与内容都不可信。
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const BUILD_GRADLE = join(__dirname, '../android/app/build.gradle');
const BUILD_SCRIPT = join(__dirname, '../scripts/build-webview.mjs');

/** 与 scripts/build-webview.mjs 的 PACKAGES 同序的五个包 id。 */
const EXPECTED_PACKAGES = [
  'chat-transcript',
  'rich-document',
  'code-editor',
  'composer-input',
  'chat-conversation',
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
  it('packages 覆盖五包且恰为五项', () => {
    const packages = parseGradlePackages(readLinesByByte(BUILD_GRADLE));
    expect(packages).toEqual(EXPECTED_PACKAGES);
    expect(packages).toHaveLength(5);
  });

  it('漏第五包即红——chat-conversation 缺失时守卫会放过白屏 APK', () => {
    const packages = parseGradlePackages(readLinesByByte(BUILD_GRADLE));
    expect(packages).toContain('chat-conversation');
  });

  it('与 build-webview.mjs 的 PACKAGES 零漂移（新增包必须同步守卫清单）', () => {
    const source = parseBuildScriptPackages();
    expect(source).toEqual(EXPECTED_PACKAGES);
    expect(parseGradlePackages(readLinesByByte(BUILD_GRADLE))).toEqual(source);
  });

  it('注释已由「四包」更新为「五包」并列全包名', () => {
    const comment = guardComment(readLinesByByte(BUILD_GRADLE));
    expect(comment).toContain('五包');
    expect(comment).not.toContain('四包');
    for (const pkg of EXPECTED_PACKAGES) {
      expect(comment).toContain(pkg);
    }
  });
});
