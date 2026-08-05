/**
 * 出厂通用 subagent 定义（运行时虚拟注入用）。
 *
 * 仅在此导出常量；`AgentRegistryService.list` 合并虚拟 `general` 的逻辑
 * 由 registry 服务实现（见 impl-core-tool 节点）。用户若 upsert 同名
 * `general`，DB 版本优先（允许覆盖）。
 *
 * @module service/agent/default-subagent-definition
 */

import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";

/**
 * 虚拟 `general` subagent：全部注册工具可用，禁止递归（递归基线）。
 *
 * `model` 不 pin，运行时跟随父 agent；`tools` 为 `undefined` 表示全部
 * 注册工具可用；`subagentCallable=false` 防止 `task` 工具递归派生。
 */
export const DEFAULT_SUBAGENT_DEFINITION: AgentDefinition = {
  name: "general",
  description: "通用助手，可以读写文件、搜索内容，完成主代理委派的任务。",
  prompts: {
    system:
      "你是一个通用助手，可以读写文件、搜索内容，完成主代理委派的任务。",
    persist: [],
    dynamic: [],
  },
  tools: undefined,
  subagentCallable: false,
};
