/**
 * 幂等种入内置技能（当前仅 agent-config，global 域）。
 *
 * {@link BUILTIN_SKILL_NAMES} 是"内置技能名"的单一来源：服务层的删除 /
 * 新建拦截（skills.service）与本 seed 共用同一份名单。
 *
 * 注意与 seedBuiltinProviders 的差异：技能没有数据行记录（存 VFS 文件），
 * 幂等与升级语义靠 kkv 版本台账实现（与 schema_migrations 的 applied
 * 记录同构）：
 *
 * - 全新库：首种当前文案；
 * - 台账版本落后：无条件重种当前文案——内置保留名技能（不可删/不可
 *   同名新建）是官方资产而非用户数据，官方文案即权威，与 migration
 *   「版本落后就执行、不比对行内容」语义一致。想定制指南的用户可复制
 *   成新技能（内置名之外的名字），路径不受影响；
 * - 台账已当前版：单次 kkv 读早退。
 *
 * 文案变更流程：改 AGENT_CONFIG_SKILL_MD、AGENT_CONFIG_SEED_VERSION +1。
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

本指南供 agent 工具的 create / update 动作参考：definition 在 create 时是完整定义体（顶层必含 name），update 时是部分更新字段（只填要改的字段）。字段形态与陷阱如下。

## AgentDefinition 字段总览

- name（必填，string）：agent 名称，非空；get / update 按 name 定位时精确匹配（两侧 trim）。
- description（可选，string）：给主 agent 看的介绍——这个 agent 擅长什么、什么时候该派它；会出现在 task 工具的候选名单里。
- mode（可选，"primary" / "subagent" / "all"，缺省按 all 解释）：
  - primary：仅用于主会话，不能被 task 工具调用；
  - subagent：仅能被 task 作为子代理调用（装配时会被强制摘除 task 工具，防递归）；
  - all：主会话与子代理调用都可以。
- prompts（可选，对象）：提示词布局，见下节三区详解。可整个省略（默认空布局：无 system、无 persist / dynamic 块）；只填 name 即可创建最简 agent。
- model（可选，string）：固定模型指针。陷阱：值是 savedModelId（保存模型的 UUID），不是模型名——填模型名会在保存时校验失败。不知道该填什么就整个字段省略，会话沿用当前模型。
- runtime（可选，对象）：
  - maxSteps：单回合最大工具步数；
  - doomLoopThreshold / doomLoopCrossRoundWindow：死循环检测阈值与跨回合窗口。
- tools（可选，对象）：工具策略，allow / deny 两个数组二选一（同时给会校验失败），元素必须是已注册工具名；缺省 = 全部已注册工具可用。工具名拼错保存时会报具体名字。

## prompts 三区布局

prompts 承载 agent 的全部提示词配置：

- system（可选，string，单段）：系统提示词，映射 API 的 system 字段。整个 agent 只有一段 system，不要拆多段。
- persist（可选，数组，缺省空数组）：持久区文本块，按顺序组成开场对话（user / assistant 剧本）。块形态：

      { "name": "块名", "type": "text", "role": "user", "content": "内容" }

  陷阱：persist 只收 type 为 "text" 的块。旧编辑器的过渡态 worktree 块（type 为 "worktree"）读入时会被剥成文本，但 definition 写出时必须 omit——不要带 worktree 块。
- persistEnabled（可选，boolean，缺省 false）：持久区开关；false 时 persist 数组保留但不参与组装。
- dynamic（可选，数组，缺省空数组）：动态区文本块，形态同 persist 但允许 lifecycle 字段（"always" / "once"，缺省 always——once 表示只在首次组装注入）。需要按上下文动态注入的内容放这里。
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

- update 是部分更新（patch）：只填要改的字段，未提供的字段保留现值；置 null 清除字段回缺省（如取消 pin 的 model）；prompts 按子键合并——只填 persist 就只换 persist。要确认现状先 get，改完全量字段也可整体提交（全量 patch = 全量覆盖，两者兼容）。
- agent 名称全局唯一（含内置 general）：撞名保存会被拒绝并提示改名。
- agent 工具不提供删除动作——删除 agent 请走用户界面的 agent 管理。
`;

/** 内置 agent-config 技能的 seed 内容版本（文案变更时 +1 并归档旧文案）。 */
export const AGENT_CONFIG_SEED_VERSION = 3;


/** seed 台账的 kkv 位置（module/key）。 */
const SEEDS_MODULE = "nm-seeds";
const AGENT_CONFIG_LEDGER_KEY = "agent-config";

/** 读 seed 台账版本（无记录返回 null）。 */
async function readSeedLedger(conn: TdbcConnection): Promise<number | null> {
  const rows = await conn.query(
    "SELECT value FROM kkv_entry WHERE module = ? AND key = ?",
    [SEEDS_MODULE, AGENT_CONFIG_LEDGER_KEY]
  );
  if (rows.length === 0) {
    return null;
  }
  const parsed = Number.parseInt(String(rows[0]!.value), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/** 台账落账（INSERT OR REPLACE，参数绑定）。 */
async function writeSeedLedger(conn: TdbcConnection): Promise<void> {
  await conn.execute(
    "INSERT OR REPLACE INTO kkv_entry (module, key, value) VALUES (?, ?, ?)",
    [SEEDS_MODULE, AGENT_CONFIG_LEDGER_KEY, String(AGENT_CONFIG_SEED_VERSION)]
  );
}

/**
 * 版本化种入内置技能（bootstrap 事务之后的公共路径，快/慢分支共用）。
 * 版本落后即无条件重种，不比对现存内容。
 *
 * WHY 走 SkillsService 而非直写 globalMetaVfs：多一层技能名 / 路径校验
 * 与领域语义。只能在 bootstrap 事务之外调用（SkillsService 内部经
 * createScopedVfsService 另起连接级装配，事务内嵌套冲突）——技能正文
 * 存 VFS（vfs_entry/revision/内容寻址 blob），migration 事务内裸写等于
 * 重实现一遍 VFS 写路径，故升级逻辑挂本 seed 而非 SCHEMA_MIGRATIONS。
 */
export async function seedBuiltinSkills(conn: TdbcConnection): Promise<void> {
  // 台账快路径：已应用当前版本 → 本次启动无事可做（稳态单次 kkv 读）。
  const applied = await readSeedLedger(conn);
  if (applied != null && applied >= AGENT_CONFIG_SEED_VERSION) {
    return;
  }
  const service = createSkillsService(conn);
  let exists = true;
  try {
    await service.readSkillFile("global", "agent-config");
  } catch (error) {
    if (!isSkillError(error, "NOT_FOUND")) {
      throw error;
    }
    exists = false;
  }
  // 版本落后：无条件重种当前文案（存在性只决定是否需要 seed 特权豁免
  // D2② 的新建拦截——首种时目录必不存在；重种走整文件覆盖）。
  await service.writeSkillFile(
    "global",
    "agent-config",
    undefined,
    AGENT_CONFIG_SKILL_MD,
    undefined,
    exists ? undefined : { builtinSeed: true }
  );
  await writeSeedLedger(conn);
}
