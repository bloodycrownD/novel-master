/**
 * 幂等种入内置技能（当前仅 agent-config，global 域）。
 *
 * {@link BUILTIN_SKILL_NAMES} 是"内置技能名"的单一来源：服务层的删除 /
 * 新建拦截（skills.service）与本 seed 共用同一份名单。
 *
 * 注意与 seedBuiltinProviders 的差异：技能没有数据行记录（存 VFS 文件），
 * 幂等语义靠"读取捕 NOT_FOUND 再写"实现——已存在（含用户改过）即跳过，
 * 不覆盖用户改动。
 *
 * @module bootstrap/skills/seed-builtin-skills
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { createSkillsService } from "@/service/skills/create-skills-service.js";
import { isSkillError } from "@/errors/skill-errors.js";

/**
 * 内置技能名名单（删除 / 新建拦截与 seed 共用的单一来源）。
 *
 * 限定语义见 skills.service 的两道门：global 域名单内不可删；两域名单内
 * 且目录不存在 = 新建，拒绝。
 */
export const BUILTIN_SKILL_NAMES: ReadonlySet<string> = new Set([
  "agent-config",
]);

/**
 * 内置 agent-config 技能正文：完整 agent 配置指南。
 *
 * 正文里的代码块用缩进式（4 空格）而非 fenced code block，行内强调用
 * 「」——整篇避开反引号与 ${，让 TS template string 无需转义（D5）。
 */
export const AGENT_CONFIG_SKILL_MD = `---
name: agent-config
description: agent 定义配置指南：AgentDefinition 全字段说明（含 workplace / persist / tools / model 陷阱）、提示词三区布局、完整 definition JSON 示例与保存注意事项，agent 工具 create / update 前先读。
---

# agent 配置指南

本指南供 agent 工具的 create / update 动作参考：definition 是完整定义体对象，字段形态与陷阱如下。

## AgentDefinition 字段总览

- name（必填，string）：agent 名称，非空；get / update 按 name 定位时精确匹配（两侧 trim）。
- description（可选，string）：给主 agent 看的介绍——这个 agent 擅长什么、什么时候该派它；会出现在 task 工具的候选名单里。
- mode（可选，"primary" / "subagent" / "all"，缺省按 all 解释）：
  - primary：仅用于主会话，不能被 task 工具调用；
  - subagent：仅能被 task 作为子代理调用（装配时会被强制摘除 task 工具，防递归）；
  - all：主会话与子代理调用都可以。
- prompts（必填，对象）：提示词布局，见下节三区详解。
- model（可选，string）：固定模型指针。陷阱：值是 savedModelId（保存模型的 UUID），不是模型名——填模型名会在保存时校验失败。不知道该填什么就整个字段省略，会话沿用当前模型。
- runtime（可选，对象）：
  - maxSteps：单回合最大工具步数；
  - doomLoopThreshold / doomLoopCrossRoundWindow：死循环检测阈值与跨回合窗口。
- tools（可选，对象）：工具策略，allow / deny 两个数组二选一（同时给会校验失败），元素必须是已注册工具名；缺省 = 全部已注册工具可用。工具名拼错保存时会报具体名字。

## prompts 三区布局

prompts 承载 agent 的全部提示词配置：

- system（可选，string，单段）：系统提示词，映射 API 的 system 字段。整个 agent 只有一段 system，不要拆多段。
- persist（必填，数组）：持久区文本块，按顺序组成开场对话（user / assistant 剧本）。块形态：

      { "name": "块名", "type": "text", "role": "user", "content": "内容" }

  陷阱：persist 只收 type 为 "text" 的块。旧编辑器的过渡态 worktree 块（type 为 "worktree"）读入时会被剥成文本，但 definition 写出时必须 omit——不要带 worktree 块。
- persistEnabled（可选，boolean，缺省 false）：持久区开关；false 时 persist 数组保留但不参与组装。
- dynamic（必填，数组）：动态区文本块，形态同 persist 但允许 lifecycle 字段（"always" / "once"，缺省 always——once 表示只在首次组装注入）。需要按上下文动态注入的内容放这里。
- dynamicEnabled（可选，boolean，缺省 false）：动态区开关。
- workplace（可选，string）：常驻工作区的助手确认语。陷阱：这是非空字符串，不是布尔——旧格式的 true 会被兼容读成「【done】」，但写出必须是字符串（开 = 非空字符串；关 = 整个字段省略）。开启后 agent 会话带常驻工作区，助手看到工作区内容后回一句确认语。
- customAttach（可选，string）：自定义附加信息，运行时以纯文本注入；开 = trim 后非空，关 = 省略。
- skillsEnabled（可选，boolean，缺省 true）：技能能力总开关。陷阱：置 false 会联动摘除 skill 工具并不注入技能索引（用户显式 $ 引用不受影响）——这个 agent 不能再用 skill load。
- skillsPrefix（可选，string）：技能索引段前缀语；缺省用默认文案，一般不用改。

## 完整示例

最小可用示例（仅 name + prompts）：

    {
      "name": "translator",
      "description": "把选定章节翻译成英文，保留叙事节奏",
      "mode": "all",
      "prompts": {
        "system": "你是资深中文小说英译者，译文自然流畅，不逐字硬译。",
        "persistEnabled": true,
        "persist": [
          { "name": "greet", "type": "text", "role": "user", "content": "请准备开始翻译任务。" },
          { "name": "ready", "type": "text", "role": "assistant", "content": "准备完毕，请提供原文。" }
        ],
        "dynamicEnabled": false,
        "dynamic": []
      }
    }

进阶示例（workplace / runtime / tools / mode）：

    {
      "name": "editor",
      "description": "在常驻工作区里做章节级修改稿",
      "mode": "subagent",
      "model": "0f9a3b2e-1c4d-4e5f-8a7b-9c0d1e2f3a4b",
      "prompts": {
        "system": "你是小说编辑，改稿保留作者声音。",
        "persistEnabled": false,
        "persist": [],
        "dynamicEnabled": true,
        "dynamic": [
          { "name": "focus", "type": "text", "role": "user", "content": "本轮只处理当前章节。", "lifecycle": "once" }
        ],
        "workplace": "我看到工作区了",
        "customAttach": "修改稿统一放 work/ 目录。",
        "skillsEnabled": true
      },
      "runtime": { "maxSteps": 40 },
      "tools": { "deny": ["agent"] }
    }

示例里的 model 值是占位 UUID，使用时换成真实 savedModelId，不要照抄。

## 操作注意事项

- definition 是整体覆盖，不是增量合并：update 时未带的字段会被清掉。所以 update 前先 get 拿最新定义，在返回值基础上改，再整体提交。
- 保存成功后定义在下一个会话/回合生效，当前运行中的会话不受影响。
- agent 工具不提供删除动作——删除 agent 请走用户界面的 agent 管理。
`;

/**
 * 幂等种入内置技能：global 域不存在则写入，存在（含用户改过）即跳过。
 *
 * WHY 走 SkillsService 而非直写 globalMetaVfs：多一层技能名 / 路径校验
 * 与领域语义。只能在 bootstrap 事务之外调用（SkillsService 内部经
 * createScopedVfsService 另起连接级装配，事务内嵌套冲突）。
 */
export async function seedBuiltinSkills(conn: TdbcConnection): Promise<void> {
  const service = createSkillsService(conn);
  try {
    // 已存在（含用户改过）——seed 不覆盖用户改动，直接跳过。
    await service.readSkillFile("global", "agent-config");
    return;
  } catch (error) {
    if (!isSkillError(error, "NOT_FOUND")) {
      throw error;
    }
  }
  await service.writeSkillFile(
    "global",
    "agent-config",
    undefined,
    AGENT_CONFIG_SKILL_MD,
    undefined,
    // 首次种入时目录必不存在，需 seed 特权豁免 D2② 的新建拦截。
    { builtinSeed: true },
  );
}
