/**
 * NewSkillModal（mobile）源码契约——ZIP 导入分支的两道修复：
 * - CR D-1：zip 落盘前过保留名新建门（assertSkillNameNotReservedForCreate）。
 * - CR MF-8：重写 SKILL.md 前先 readSkillFile 拿 version，writeSkillFile
 *   传 {expectedVersion}（对齐 desktop edadb49，否则必撞 VFS CONFLICT）。
 *
 * 整屏组件依赖太重（runtime/keyboard/modal），按本仓惯例钉源码契约。
 */
import {describe, expect, it} from '@jest/globals';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const src = readFileSync(
  join(__dirname, '..', 'src', 'components', 'skills', 'NewSkillModal.tsx'),
  'utf8',
);

describe('NewSkillModal ZIP 导入源码契约（CR D-1 / MF-8）', () => {
  it('D-1：zipSvc.import 之前过保留名新建门，拒绝时不落盘', () => {
    const assertIdx = src.indexOf('assertSkillNameNotReservedForCreate(');
    const importIdx = src.indexOf('zipSvc.import(');
    expect(assertIdx).toBeGreaterThanOrEqual(0);
    expect(importIdx).toBeGreaterThanOrEqual(0);
    // 校验必须发生在 zip 落盘之前（同名 await 调用，抛错即中止后续落盘）
    expect(assertIdx).toBeLessThan(importIdx);
    // 调用形态：域 + 名 + project 域 projectId（排版容忍，锁首参为 domain）
    expect(src).toMatch(/assertSkillNameNotReservedForCreate\(\s*domain,/);
  });

  it('MF-8：重写分支先 readSkillFile 拿版本，writeSkillFile 传 expectedVersion', () => {
    // 重写分支（表单值与 zip 元数据不一致时触发）：read 在 write 之前
    const branchIdx = src.indexOf('imported.preview.name !== name');
    expect(branchIdx).toBeGreaterThanOrEqual(0);
    const segment = src.slice(branchIdx);
    const readIdx = segment.indexOf('readSkillFile(');
    const writeIdx = segment.indexOf('writeSkillFile(');
    expect(readIdx).toBeGreaterThanOrEqual(0);
    expect(writeIdx).toBeGreaterThanOrEqual(0);
    expect(readIdx).toBeLessThan(writeIdx);
    // 版本从 read 结果取并透传（VFS 乐观锁）
    expect(src).toContain('{expectedVersion: read.version}');
  });
});
