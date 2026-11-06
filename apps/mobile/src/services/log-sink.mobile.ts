/**
 * 移动端日志文件 sink 与 JS 崩溃钩子（logger-normalization T3 / spec 4.5）。
 *
 * 落 `<filesDir>/logs`（Android 上即 react-native-blob-util 的 DocumentDir；
 * Jest 里是 `/documents`），行格式与 desktop / CLI 对齐：
 * `${ISO时间}\t${level}\t${scope}\t${message}\t${detailJSON}`。
 *
 * 轮转策略在 core（`planLogFileWrite`），本文件只负责「写到哪 + 每份文件已写
 * 字节数的内存维护」——策略是纯函数、不回写 existing，不累加就永远不会切段。
 *
 * WHY 本文件允许裸 `console.warn`：文件 sink 的失败兜底不能回调 logger
 * （logger → sink → 失败 → logger 会无限递归），no-raw-console 守卫把它列为
 * 唯一白名单。
 */
import {addLogSink, createLogger, planLogFileWrite} from '@novel-master/core/log';
import type {LogLevel} from '@novel-master/core/log';
import {utf8ByteLength} from '@novel-master/core/common';
import {blobFs} from './rn-file-io';

const LEVEL_RANK: Record<LogLevel, number> = {debug: 0, info: 1, warn: 2, error: 3};

/**
 * 安装文件 sink：建目录 → 用 `ls`/`stat` 校准每份文件的字节数与 mtime →
 * 追加 sink 并返回摘除函数。
 *
 * 写入走串行 promise 链，保证同一时刻只有一个 append 在读-改-写字节状态；
 * 任何写入异常只 `console.warn` 一次（不回流 logger，避免递归）。
 */
// nm-style: keep-public — 启动接线在 apps/mobile/index.js（JS 入口不在 TS 引用扫描面内）。
export async function installMobileLogSink(): Promise<() => void> {
  const fs = blobFs();
  const dir = `${fs.dirs.DocumentDir}/logs`;
  const minLevel: LogLevel = typeof __DEV__ !== 'undefined' && __DEV__ ? 'debug' : 'info';
  const files = new Map<string, {mtimeMs: number; bytes: number}>();
  await fs.mkdir(dir).catch(() => undefined);
  for (const name of (await fs.ls(dir).catch(() => [])) ?? []) {
    if (!name.endsWith('.log')) {
      continue;
    }
    const stat = await fs.stat(`${dir}/${name}`).catch(() => null);
    files.set(name, {mtimeMs: stat?.lastModified ?? 0, bytes: stat?.size ?? 0});
  }
  let chain: Promise<void> = Promise.resolve();
  let warned = false;
  return addLogSink({
    write(record) {
      if (LEVEL_RANK[record.level] < LEVEL_RANK[minLevel]) {
        return;
      }
      const line = `${new Date(record.ts).toISOString()}\t${record.level}\t${record.scope}\t${record.message}\t${JSON.stringify(record.detail) ?? ''}\n`;
      chain = chain
        .then(async () => {
          const now = new Date();
          const dateKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
          const plan = planLogFileWrite({
            now,
            existing: [...files].map(([name, entry]) => ({name, ...entry})),
            appendBytes: utf8ByteLength(line),
            baseName: `nm-${dateKey}`,
          });
          for (const name of plan.deleteNames) {
            files.delete(name);
            await fs.unlink(`${dir}/${name}`).catch(() => undefined);
          }
          const written = await fs.appendFile(`${dir}/${plan.targetName}`, line, 'utf8');
          files.set(plan.targetName, {
            mtimeMs: now.getTime(),
            bytes: (files.get(plan.targetName)?.bytes ?? 0) + (typeof written === 'number' ? written : utf8ByteLength(line)),
          });
        })
        .catch((error: unknown) => {
          if (warned) {
            return;
          }
          warned = true;
          console.warn('[nm-log] write failed', error);
        });
    },
  });
}

const crashLog = createLogger('crash');

/**
 * 安装 JS 全局崩溃钩子：先记 `uncaught_js_error`，再链式调用旧处理器。
 *
 * 不链式会让 RN 的 redbox / 崩溃上报 / 致命退出流程全部失效。钩子同步安装，
 * 不依赖文件 sink 是否就绪（落盘本身是 best-effort，Kotlin 侧同步写才是兜底）。
 */
// nm-style: keep-public — 启动接线在 apps/mobile/index.js（JS 入口不在 TS 引用扫描面内）。
export function installJsCrashHandler(): void {
  if (typeof ErrorUtils === 'undefined') {
    return;
  }
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    crashLog.error('uncaught_js_error', {error, isFatal});
    previous(error, isFatal);
  });
}
