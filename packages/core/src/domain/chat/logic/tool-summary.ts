/**
 * 工具调用入参摘要（**三端唯一单源**）。
 *
 * @module domain/chat/logic/tool-summary
 *
 * 历史背景：本函数此前在三个地方各有一份副本（desktop renderer / mobile WebView /
 * mobile RN），三份各带不同的特判分支——同一条 `skill` 调用在 desktop 显示
 * `read global:my-skill`、在 mobile 两面显示裸 JSON；同一条 `task` 调用反过来。
 * 现已收敛到本文件，三处改为引用 core 公共面导出（`@novel-master/core/chat`）。
 *
 * ⚠️ **公共尾巴的取值语义定死为 `??`（不是 `||`）**：`input.path ?? input.dir ?? input.from`
 * 只在 `null`/`undefined` 时回落，空串算「明确给出的值」直接返回空串。
 * WebView 旧副本用的是 `||`（空串会回落 `dir`），那是历史偶然；单源取 `??`，
 * 差异由 `test/chat/tool-summary.test.ts` 的「空串 path 回落语义」用例钉住。
 */

/** 摘要入参（取三份旧签名的并集：WebView 侧允许 null/undefined）。 */
type ToolInput = Record<string, unknown> | null | undefined;

/**
 * 生成工具调用入参的一行摘要。
 *
 * 分支顺序：`!input` → `""`；`skill` → skill 摘要；`task` → `@agent · desc`；
 * `fs` → `action path`（mv/cp 带 `from → to`）；`agent` → `action name`；
 * 其余走公共尾巴（path/dir/from → 120 字符截断的 JSON → 键名列表）。
 *
 * @param name 工具名
 * @param input 工具入参原始对象（可为 null/undefined）
 */
export function summarizeToolInput(
  name: string,
  input: ToolInput
): string {
  if (!input) {
    return "";
  }
  // skill 摘要：`action domain:name`；缺省域时只展示 action + name。
  if (name === "skill") {
    const action = typeof input.action === "string" ? input.action : "";
    const skillName = typeof input.name === "string" ? input.name : "";
    const domain =
      input.domain === "global" || input.domain === "project"
        ? input.domain
        : undefined;
    return domain != null
      ? `${action} ${domain}:${skillName}`
      : `${action} ${skillName}`.trim();
  }
  // task 摘要：`@agent · description`，比裸 JSON 可读。
  if (name === "task") {
    const desc =
      typeof input.description === "string" ? input.description.trim() : "";
    const agent =
      typeof input.subagentName === "string" ? input.subagentName : "";
    const parts: string[] = [];
    if (agent) parts.push(`@${agent}`);
    if (desc) parts.push(desc);
    return parts.join(" · ");
  }
  // fs 摘要：`action path`（mv/cp 为 `action from → to`）。卡片工具名只写「fs」，
  // 不带子命令时用户看不出这次是 ls 还是 mkdir；ls 省略 path = 列根目录，显示
  // `ls /`。空串 path 按省略处理（fs 无「明确空值」语义，与公共尾巴的 `??` 定死
  // 语义无关）。缺参（如 cp 少 to）展示已有部分，不全则回落公共尾巴。
  if (name === "fs") {
    const action =
      typeof input.action === "string" ? input.action.trim() : "";
    const from = input.from;
    const to = input.to;
    if (action === "mv" || action === "cp") {
      const fromText = typeof from === "string" ? from : "";
      const toText = typeof to === "string" ? to : "";
      if (fromText !== "" && toText !== "") {
        return `${action} ${fromText} → ${toText}`;
      }
      if (fromText !== "" || toText !== "") {
        return `${action} ${fromText || toText}`;
      }
    }
    const path = input.path;
    if (typeof path === "string" && path !== "") {
      return action !== "" ? `${action} ${path}` : path;
    }
    if (action === "ls") {
      return "ls /";
    }
    if (action !== "") {
      return action;
    }
    // action 与 path 全缺：回落公共尾巴（JSON 截断兜底）
  }
  // agent 摘要：`action name`（照 fs 的 action 前缀模式——卡片只写「agent」
  // 看不出在管理哪个智能体，且 definition 大对象会撑成 JSON 截断一坨）。
  // 名字取值 name > definition.name（create/update 的定义体必带 name 作
  // upsert key）> `id:agentId`；list 无目标显示裸 action。
  if (name === "agent") {
    const action =
      typeof input.action === "string" ? input.action.trim() : "";
    const definition =
      input.definition != null &&
      typeof input.definition === "object" &&
      !Array.isArray(input.definition)
        ? (input.definition as Record<string, unknown>)
        : undefined;
    const nameFromDefinition =
      typeof definition?.name === "string" ? definition.name : undefined;
    const agentName =
      typeof input.name === "string" && input.name !== ""
        ? input.name
        : nameFromDefinition;
    const idText =
      typeof input.agentId === "string" && input.agentId !== ""
        ? `id:${input.agentId}`
        : undefined;
    if (action !== "") {
      const target =
        agentName != null && agentName !== "" ? agentName : idText;
      return target != null && target !== ""
        ? `${action} ${target}`
        : action;
    }
    // action 缺失：回落公共尾巴（JSON 截断兜底）
  }
  const path = input.path ?? input.dir ?? input.from;
  if (typeof path === "string") {
    return path;
  }
  const keys = Object.keys(input);
  if (keys.length === 0) {
    return "";
  }
  try {
    const raw = JSON.stringify(input);
    return raw.length > 120 ? `${raw.slice(0, 117)}…` : raw;
  } catch {
    return keys.join(", ");
  }
}