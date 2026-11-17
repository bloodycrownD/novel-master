/**
 * skill 卡片跳转三元组解析（**权威实现**：core `domain/chat/logic/skill-tool-ref.ts`
 * 的 `skillToolRefResolver`；本文件是 WebView bundle 的镜像）。
 *
 * 镜像原因：core 该模块既未在 `packages/core/package.json` 的 exports 里暴露叶子
 * 子路径，也不在 webview 构建门 B 的 core 白名单（`scripts/build-webview.mjs` 的
 * `WEBVIEW_CORE_ALLOWLIST`）；经 `@novel-master/core/chat` barrel 引入会把整条闭包
 * 拉进 bundle，故不能直接 import。**镜像纪律**：action 集与返回通道必须与 core
 * 一致（`load/read/write/edit`；解析不出返回 `undefined`，宿主 `ToolCallView.skillRef`
 * 同为此约定）。
 *
 * write/edit 的三元组必含于 tool_use 输入，这里直接解析；read/load 缺省域命中
 * 生效副本的解析结果由宿主经行数据 `skillRef` 透传（tool_result meta），
 * `skillToolRef` 优先取它。
 */
import type {SkillRefMeta, ToolCallRow} from '../state/state';

const SKILL_TOOL_NAME = 'skill';

/** 输入里可解析出跳转三元组的 action（与 core REF_ACTIONS 同集：list 无目标技能）。 */
const REF_ACTIONS: Record<string, number> = {
  load: 1,
  read: 1,
  write: 1,
  edit: 1,
};

/**
 * 解析卡片跳转三元组：优先行数据透传的 skillRef（read 缺省域的命中结果），
 * 否则从 tool_use 输入解析（write/edit；pending 的 read 缺省域解析不出）。
 */
export function skillToolRef(tool: ToolCallRow, projectId?: string): SkillRefMeta | undefined {
  if (tool.skillRef != null) return tool.skillRef;
  const name = tool.name || '';
  if (name !== SKILL_TOOL_NAME) return undefined;
  const input = tool.input || {};
  const action = input.action;
  if (typeof action !== 'string' || !REF_ACTIONS[action]) return undefined;
  const skillName = input.name;
  if (typeof skillName !== 'string' || skillName.length === 0) return undefined;
  const rawDomain = input.domain;
  // domain 缺省：write/edit 补工具同款默认 project；load/read 缺省读生效副本，
  // 实际命中域只有工具输出知道——返回 undefined，等行数据透传的 skillRef。
  const domain = rawDomain === 'global' || rawDomain === 'project' ? rawDomain : action === 'load' || action === 'read' ? undefined : 'project';
  if (domain == null) return undefined;
  return {
    domain,
    name: skillName,
    ...(domain === 'project' && projectId != null ? {projectId} : {}),
  };
}
