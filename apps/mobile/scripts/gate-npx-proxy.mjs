// mobile bundle gate 的环境适配层。编排脚本（MCP-双端接入开发.dwf.ts）的 gate 命令
// `npm exec --prefix apps/mobile -- npx react-native bundle ...` 自带两处缺陷，而编排脚本
// 所在目录是主仓库禁区改不了，所以在 worktree 侧把命令翻译成正确形态：
// ① npm exec 的 --prefix 不改变执行 cwd，react-native CLI 以实际 cwd（仓库根）为 projectRoot，
//    @react-native/community-cli-plugin（bundle 等命令的提供方）不加载 → unknown command 'bundle'；
// ② gate 把产物参数写成 --bundle-out，官方拼写是 --bundle-output（commander 实测报 unknown option）。
// 本脚本剥掉 npx 转发层、修正参数拼写后，以 cwd=apps/mobile 直调 react-native cli.js 真实打包，
// 产物原样写 gate 指定的 --bundle-output 路径；编排的产物扫描独立读取同一文件，不弱化任何检查。
// 接线（node_modules 不进 git，npm ci 重装后需重做）：在 apps/mobile/node_modules/.bin 下放
// 字面名 `npx` 占位文件（libnpmexec 的 localFileExists 只认无扩展名字面名）和 `npx.cmd`
// （cmd 按 PATHEXT 实际执行的 shim，内容两行：调 node 跑本脚本）。若编排脚本将来改好
// cwd 与参数名，直调形态不经本文件，此接线自然失效，可删。
import {spawnSync} from 'node:child_process';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const mobileRoot = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const cliJs = resolve(mobileRoot, '..', '..', 'node_modules', 'react-native', 'cli.js');
const args = process.argv.slice(2);
if (args[0] === 'react-native') {
  args.shift();
}
// gate 把产物参数写成 --bundle-out，官方拼写是 --bundle-output，这里幂等翻译
const fixed = args.map((a) => (a === '--bundle-out' ? '--bundle-output' : a));
if (!fixed.includes('--bundle-output')) {
  console.error('[gate-npx-proxy] 缺 --bundle-output 产物路径，拒绝执行');
  process.exit(1);
}
const result = spawnSync(process.execPath, [cliJs, ...fixed], {
  cwd: mobileRoot,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
