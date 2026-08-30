/**
 * skill 卡片跳转三元组解析（core `domain/chat/logic/skill-tool-ref.ts` 的 WebView 镜像）。
 *
 * write/edit 的三元组必含于 tool_use 输入，这里直接解析；read 缺省域命中
 * 生效副本的解析结果由宿主经行数据 `skillRef` 透传（tool_result meta），
 * `skillToolRef` 优先取它。漏了这份镜像，transcript 内的 skill 卡片
 * 将不可点（对称 `vfs-tool-path.ts` 的镜像先例）。
 */
import type {SkillRefMeta, ToolCallRow} from '../state/state';

const SKILL_TOOL_NAME = 'skill';

/** 输入里可解析出跳转三元组的 action（list 无目标技能）。 */
const REF_ACTIONS: Record<string, number> = {
  read: 1,
  write: 1,
  edit: 1,
};

export function resolveSkillToolRefFromInput(
  name: string,
  input: Record<string, unknown> | null | undefined,
  projectId?: string,
): SkillRefMeta | null {
  if (name !== SKILL_TOOL_NAME) return null;
  const action = input && input.action;
  if (typeof action !== 'string' || !REF_ACTIONS[action]) return null;
  const skillName = input && input.name;
  if (typeof skillName !== 'string' || skillName.length === 0) return null;
  const rawDomain = input && input.domain;
  // domain 缺省：write/edit 补工具同款默认 project；read 缺省读生效副本，
  // 实际命中域只有工具输出知道——返回 null，等行数据透传的 skillRef。
  const domain =
    rawDomain === 'global' || rawDomain === 'project'
      ? rawDomain
      : action === 'read'
      ? null
      : 'project';
  if (domain == null) return null;
  return {
    domain,
    name: skillName,
    ...(domain === 'project' && projectId != null ? {projectId} : {}),
  };
}

/**
 * 解析卡片跳转三元组：优先行数据透传的 skillRef（read 缺省域的命中结果），
 * 否则从 tool_use 输入解析（write/edit；pending 的 read 缺省域解析不出）。
 */
export function skillToolRef(
  tool: ToolCallRow,
  projectId?: string,
): SkillRefMeta | null {
  if (tool.skillRef != null) return tool.skillRef;
  return resolveSkillToolRefFromInput(
    tool.name || '',
    tool.input || {},
    projectId,
  );
}
