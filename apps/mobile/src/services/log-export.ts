/**
 * 诊断日志导出（logger-normalization T3 / spec 4.5）。
 *
 * 把 `<filesDir>/logs/*.log` 合并成单个 `.txt` 交给系统「另存为」：
 * 每个文件前加 `===== <文件名> (<字节>) =====` 分隔头；总量超过 8MB 时
 * 从最旧的文件开始丢弃，并在头部写明丢了几个。
 */
import {utf8ByteLength} from '@novel-master/core/common';
import {exportBytesViaDocumentPicker} from './document-io';
import {blobFs} from './rn-file-io';

/** 导出内容总字节上限；超出时从最旧的文件开始丢。 */
const MAX_EXPORT_BYTES = 8 * 1024 * 1024;

/** 导出全部日志文件；返回 'saved' / 'cancelled'（用户取消保存框）。 */
// nm-style: keep-public — 独立 IO 管线（读日志目录 + 8MB 截断 + 系统保存框），屏幕只负责按钮状态。
export async function exportMobileLogs(): Promise<'saved' | 'cancelled'> {
  const fs = blobFs();
  const dir = `${fs.dirs.DocumentDir}/logs`;
  const files: {name: string; text: string; bytes: number; mtimeMs: number}[] = [];
  for (const name of (await fs.ls(dir).catch(() => [])) ?? []) {
    if (!name.endsWith('.log')) {
      continue;
    }
    const path = `${dir}/${name}`;
    const raw = await fs.readFile(path, 'utf8').catch(() => null);
    if (raw == null) {
      continue;
    }
    const text = String(raw);
    const stat = await fs.stat(path).catch(() => null);
    files.push({name, text, bytes: stat?.size ?? utf8ByteLength(text), mtimeMs: stat?.lastModified ?? 0});
  }
  // 新→旧：超限时截断的总是更旧的那批；拼接时再翻回旧→新，读起来按时间顺序。
  files.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
  const kept: typeof files = [];
  let total = 0;
  for (const file of files) {
    if (total + file.bytes > MAX_EXPORT_BYTES) {
      break;
    }
    kept.push(file);
    total += file.bytes;
  }
  const dropped = files.length - kept.length;
  const header = dropped > 0 ? `[truncated: dropped ${dropped} file(s)]\n` : '';
  const sections = [...kept].reverse().map(file => `===== ${file.name} (${file.bytes}) =====\n${file.text}${file.text.endsWith('\n') ? '' : '\n'}`);
  const body = header + sections.join('');
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  const fileName = `nm-logs-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.txt`;
  return exportBytesViaDocumentPicker({
    fileName,
    mimeType: 'text/plain',
    write: async tmpPath => {
      await fs.writeFile(tmpPath, body, 'utf8');
    },
  });
}
