/**
 * SkillInfoEditModal（mobile）源码契约——技能重命名与描述编辑：
 * - 提交走 runtime skills updateSkillInfo，只提交真正变更的字段。
 * - global 域内置技能名称框只读（editable={!builtin}）。
 * - 调用方（管理页/详情页）invalid 技能入口禁用；详情页改名后
 *   setParams 同步栈内定位。
 * - NewSkillModal 的 front matter 重写已回收为 core 单源消费。
 *
 * 整屏组件依赖太重（runtime/keyboard/modal），按本仓惯例钉源码契约
 * （同 new-skill-modal-contract.test.ts）。
 */
import {describe, expect, it} from '@jest/globals';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const readSrc = (...parts: string[]) =>
  readFileSync(join(__dirname, '..', 'src', ...parts), 'utf8');

const modalSrc = readSrc('components', 'skills', 'SkillInfoEditModal.tsx');
const manageSrc = readSrc('screens', 'stack', 'SkillsSettingsScreen.tsx');
const detailSrc = readSrc('screens', 'stack', 'SkillDetailScreen.tsx');
const newSkillSrc = readSrc('components', 'skills', 'NewSkillModal.tsx');

describe('SkillInfoEditModal 源码契约（T-S5）', () => {
  it('提交走 runtime skills updateSkillInfo，只提交变更字段', () => {
    expect(modalSrc).toMatch(/skills\(\)\.updateSkillInfo\(/);
    // 变更检测：仅字段真的变了才进提交参数；判定与提交值统一先 trim
    // （对齐 desktop：首尾空白不算变更、不带空白落盘，MF-8）
    expect(modalSrc).toMatch(/const trimmedName = name\.trim\(\)/);
    expect(modalSrc).toMatch(/const trimmedDesc = description\.trim\(\)/);
    expect(modalSrc).toMatch(/nameChanged/);
    expect(modalSrc).toMatch(/descChanged/);
    expect(modalSrc).toMatch(
      /nameChanged = !builtin && trimmedName !== target\.name/,
    );
    expect(modalSrc).toMatch(
      /descChanged = trimmedDesc !== \(currentDescription \?\? ''\)/,
    );
    expect(modalSrc).toMatch(
      /\.\.\.\(nameChanged \? \{newName: trimmedName\} : \{\}\)/,
    );
    expect(modalSrc).toMatch(
      /\.\.\.\(descChanged \? \{description: trimmedDesc\} : \{\}\)/,
    );
  });

  it('global 域内置技能：名称框只读（builtin 判定 + editable）', () => {
    expect(modalSrc).toMatch(
      /target\.domain === 'global' && BUILTIN_SKILL_NAMES\.has\(target\.name\)/,
    );
    expect(modalSrc).toMatch(/editable=\{!builtin\}/);
    expect(modalSrc).toMatch(/内置技能不可改名/);
  });

  it('保存成功回传最新技能名（调用方据此刷新导航状态）', () => {
    expect(modalSrc).toMatch(
      /onSaved\(nameChanged \? trimmedName : target\.name\)/,
    );
  });
});

describe('入口接线源码契约（T-S5）', () => {
  it('管理页行菜单有「编辑信息」，invalid 技能置灰', () => {
    expect(manageSrc).toMatch(/'编辑信息'/);
    expect(manageSrc).toMatch(/disabled: !menuTarget\.item\.valid/);
    expect(manageSrc).toMatch(/<SkillInfoEditModal/);
  });

  it('详情页头部入口：invalid 禁用 + 改名后 setParams 同步', () => {
    expect(detailSrc).toMatch(/skill-detail-edit-info/);
    expect(detailSrc).toMatch(/disabled=\{!item\.valid\}/);
    expect(detailSrc).toMatch(/navigation\.setParams\(\{name: newName\}\)/);
    expect(detailSrc).toMatch(/<SkillInfoEditModal/);
  });
});

describe('NewSkillModal 消费 core 单源（front matter 重写回收）', () => {
  it('经 skill-ui 再导出消费 withSkillFrontMatterValues，无私有实现', () => {
    expect(newSkillSrc).toMatch(
      /import \{[\s\S]*?withSkillFrontMatterValues,[\s\S]*?\} from '\.\/skill-ui'/,
    );
    // 私有实现已删：不得再出现旧签名的函数定义
    expect(newSkillSrc).not.toMatch(
      /function withFrontMatterValues\(/,
    );
    // 文案更新：不再声称创建后不可改
    expect(newSkillSrc).toMatch(/可在管理页重命名/);
    expect(newSkillSrc).not.toMatch(/创建后不可改/);
  });

  it('skill-ui.ts 再导出来自 core 单源', () => {
    const skillUiSrc = readSrc('components', 'skills', 'skill-ui.ts');
    expect(skillUiSrc).toMatch(
      /export \{withSkillFrontMatterValues\} from '@novel-master\/core\/skills'/,
    );
  });
});
