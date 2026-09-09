/**
 * NewSkillModal（mobile）源码契约——ZIP 导入分支的修复：
 * - CR D-1：zip 落盘前过保留名新建门（assertSkillNameNotReservedForCreate）。
 *
 * 整屏组件依赖太重（runtime/keyboard/modal），按本仓惯例钉源码契约。
 *
 * 源码契约测豁免（tests/G-3）：NewSkillModal 依赖 runtime Context、键盘避让与
 * 弹层体系，TestRenderer 行为化需 mock 整条链；本文件锁的是 zip 落盘前的
 * 保留名校验顺序与重写分支的直写形态，属于调用时序契约，源码断言保留。
 */
import {describe, expect, it} from '@jest/globals';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const src = readFileSync(
  join(__dirname, '..', 'src', 'components', 'skills', 'NewSkillModal.tsx'),
  'utf8',
);

describe('NewSkillModal ZIP 导入源码契约（CR D-1）', () => {
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

  it('重写分支存在 writeSkillFile 直写，无 readSkillFile / expectedVersion 残留', () => {
    // 重写分支（表单值与 zip 元数据不一致时触发）：分支内走 writeSkillFile
    const branchIdx = src.indexOf('imported.preview.name !== name');
    expect(branchIdx).toBeGreaterThanOrEqual(0);
    const segment = src.slice(branchIdx);
    expect(segment.indexOf('writeSkillFile(')).toBeGreaterThanOrEqual(0);
    // 文件写入版本校验已整体下线（last-write-wins）：全文不得再出现
    // readSkillFile / expectedVersion 残留。
    expect(src).not.toContain('readSkillFile(');
    expect(src).not.toContain('expectedVersion');
  });
});
