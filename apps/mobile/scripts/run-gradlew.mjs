// 跨平台 gradle 启动器：Windows 用 gradlew.bat，其余平台用 ./gradlew（cr gates/G-4）
import {spawnSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const androidDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'android',
);
const cmd = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const result = spawnSync(cmd, process.argv.slice(2), {
  cwd: androidDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
