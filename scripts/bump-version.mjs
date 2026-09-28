// bump-version.mjs — 发版版本号 bump（desktop/mobile package.json + android build.gradle）
// 用法：node scripts/bump-version.mjs <新版本>    例：node scripts/bump-version.mjs 1.5.25
// from 版本自动读 apps/desktop/package.json（发版双端同 bump；mobile 若不同步会 SKIP 报警）。
// 两个 package.json 走 utf8 文本替换（只动版本行，保持行尾/其余字节不变）+ 解析验证；
// build.gradle 必须走 Buffer 字节级替换——该文件含历史非法 UTF-8 字节，
// 经 utf8 字符串读写会把乱码行洗成 U+FFFD（教训见 docs/apm/RULE.md）。
// versionCode 不在此脚本管（出包时 gradle -PversionCode= 传入）。
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const to = process.argv[2];
if (!to || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(to)) {
  console.error('用法: node scripts/bump-version.mjs <新版本>    例: 1.5.25');
  process.exit(1);
}

const desktop = JSON.parse(readFileSync(join(root, 'apps/desktop/package.json'), 'utf8'));
const from = desktop.version;
if (from === to) {
  console.error(`新版本与 apps/desktop/package.json 当前版本相同: ${to}`);
  process.exit(1);
}
console.log(`bump: ${from} -> ${to}`);

let failed = false;
for (const rel of ['apps/desktop/package.json', 'apps/mobile/package.json']) {
  const p = join(root, rel);
  const text = readFileSync(p, 'utf8');
  const needle = `"version": "${from}"`;
  const count = text.split(needle).length - 1;
  if (count !== 1) {
    console.log(`SKIP(匹配数=${count}, 期望 1): ${rel} — 当前版本可能与 desktop 不同步，人工核对`);
    failed = true;
    continue;
  }
  writeFileSync(p, text.replace(needle, `"version": "${to}"`), 'utf8');
  console.log('BUMPED:', rel);
}

// build.gradle：Buffer 字节级（禁 utf8 串读写）；needle 对齐 versionName 默认值的三元 else 分支
{
  const p = join(root, 'apps/mobile/android/app/build.gradle');
  const needle = Buffer.from(`?: "${from}"`, 'ascii');
  const buf = readFileSync(p);
  const first = buf.indexOf(needle);
  const second = first >= 0 ? buf.indexOf(needle, first + 1) : -1;
  if (first < 0 || second >= 0) {
    console.log(`SKIP(匹配数=${first < 0 ? 0 : '2+'}): build.gradle — versionName 可能与 package.json 不同步，人工核对`);
    failed = true;
  } else {
    const next = Buffer.concat([
      buf.subarray(0, first),
      Buffer.from(`?: "${to}"`, 'ascii'),
      buf.subarray(first + needle.length),
    ]);
    writeFileSync(p, next);
    console.log('BUMPED(Buffer): apps/mobile/android/app/build.gradle | 文件字节数', buf.length, '->', next.length);
  }
}

// 解析验证（RULE 纪律：bump 后必须验证 package.json 可解析）
for (const rel of ['apps/desktop/package.json', 'apps/mobile/package.json']) {
  const j = JSON.parse(readFileSync(join(root, rel), 'utf8'));
  console.log('PARSE-OK:', rel, 'version =', j.version);
}
process.exit(failed ? 1 : 0);
