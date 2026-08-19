/**
 * 手输 `$` typeahead：最多 5 条（名称/描述模糊匹配），点选插 `$技能名` token。
 * 形态对齐 AtPathTypeahead；候选为合并视图（无效技能不出现）。
 */
import type { EffectiveSkillDto } from "@shared/ipc-types";
import { skillDomainLabel } from "@/features/skills/skill-ui";

export type SkillTypeaheadProps = {
  open: boolean;
  candidates: readonly EffectiveSkillDto[];
  onSelect: (name: string) => void;
};

export function SkillTypeahead({
  open,
  candidates,
  onSelect,
}: SkillTypeaheadProps) {
  if (!open || candidates.length === 0) {
    return null;
  }
  return (
    <ul
      className="chat-composer__typeahead"
      role="listbox"
      aria-label="技能建议"
    >
      {candidates.map((skill) => (
        <li key={skill.name} role="option">
          <button
            type="button"
            className="chat-composer__typeahead-item chat-composer__typeahead-item--skill"
            onMouseDown={(e) => {
              // 避免抢 textarea blur 导致点选失败（对齐 AtPathTypeahead）
              e.preventDefault();
              onSelect(skill.name);
            }}
          >
            <span className="chat-composer__skill-name">{skill.name}</span>
            <span className="chat-composer__skill-desc">
              <span className="skill-domain-badge">
                {skillDomainLabel(skill.domain, skill.overridden)}
              </span>
              {skill.disabled ? <span className="chat-composer__skill-off">已关闭</span> : null}
              {skill.description ?? ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
