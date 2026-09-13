/**
 * SkillService 端口：两域技能的清单 / 合并视图 / 文件读写 / 启停 / 复制删除。
 *
 * @module service/skills/skills.port
 */

import type { EffectiveSkill } from "@/domain/skills/logic/effective-skills.js";
import type {
  SkillDomain,
  SkillSummary,
} from "@/domain/skills/model/skill.schema.js";

/** 技能清单查询域：global 全局域，或某个项目域。 */
export type SkillListScope = "global" | { readonly projectId: string };

/** 技能清单条目：front matter 元数据 + 有效性 + 技能目录内文件列表。 */
export interface SkillListItem extends SkillSummary {
  /** 相对技能目录的文件路径（含 SKILL.md，若有），按字典序稳定。 */
  readonly files: readonly string[];
}

/** 技能文件读取结果。`domain` 是实际命中的域（生效副本解析后）。 */
export interface SkillFileContent {
  readonly domain: SkillDomain;
  readonly name: string;
  /** 相对技能目录的路径（缺省读取时为 SKILL.md）。 */
  readonly path: string;
  readonly content: string;
  readonly version: number;
}

/** edit 局部修改的匹配参数（语义同 VFS replace / edit 工具）。 */
export interface SkillEditMatch {
  readonly oldString: string;
  readonly newString: string;
  readonly replaceAll?: boolean;
}

/** 技能位置（deleteSkill 的入参形态）。 */
export interface SkillLocation {
  readonly domain: SkillDomain;
  /** project 域必带；global 域缺省。 */
  readonly projectId?: string;
  readonly name: string;
}

/**
 * writeSkillFile 选项。
 *
 * builtinSeed 仅供 core 内置技能 seed 通道（bootstrap）使用：绕过内置保留名
 * 的新建拦截完成首次种入。用户路径（UI / IPC / LLM 工具）一律不传。
 */
export interface SkillWriteOptions {
  readonly builtinSeed?: boolean;
}

/** updateSkillInfo 的变更字段：至少一项，未提交字段不动。 */
export interface SkillInfoChanges {
  /** 新技能名（= 目录迁移）；缺省表示不改名。 */
  readonly newName?: string;
  /** 新描述（重写 SKILL.md front matter）；缺省表示不改描述。 */
  readonly description?: string;
}

/**
 * 技能应用服务。
 *
 * @remarks 读写经 ScopedVfsService 落 `vfs_entry`（两域逻辑前缀
 * `/meta/skills/{name}/`）；负清单读写 `skill_disabled_rule`。
 */
export interface SkillService {
  /** 技能清单（含 files 相对路径、front matter 元数据、有效性）。 */
  listSkills(scope: SkillListScope): Promise<SkillListItem[]>;

  /**
   * 当前项目的合并视图（global ∪ project、同名项目覆盖、禁用过滤），
   * 供索引预算 / `$` 候选 / 面板共用。
   */
  effectiveSkills(projectId: string): Promise<EffectiveSkill[]>;

  /**
   * 读取技能文件。
   *
   * `path` 缺省读 SKILL.md；`domain` 缺省按生效副本解析（同名项目副本
   * 优先，无项目副本回落 global，此时 `projectId` 提供解析上下文）；
   * 显式传 `domain` 时读对应域原件。
   */
  readSkillFile(
    domain: SkillDomain | undefined,
    name: string,
    path?: string,
    projectId?: string
  ): Promise<SkillFileContent>;

  /**
   * 写技能文件（整文件覆盖）。
   *
   * 须显式域（缺域抛 `SkillError(MISSING_DOMAIN)`）；新建技能 = 向新
   * 目录写 SKILL.md，技能名须过 SKILL_NAME_PATTERN 校验。内置保留名在
   * 目录不存在（= 新建）时抛 `SkillError(BUILTIN_SKILL_NAME_RESERVED)`；
   * 目录已存在（内置本体 / 历史副本）的编辑放行；seed 通道传
   * `options.builtinSeed` 豁免新建拦截。
   */
  writeSkillFile(
    domain: SkillDomain | undefined,
    name: string,
    path: string | undefined,
    content: string,
    projectId?: string,
    options?: SkillWriteOptions
  ): Promise<{ version: number }>;

  /**
   * 新建语义的内置保留名校验（D2② 门独立暴露，供 ZIP 导入等不经
   * writeSkillFile 的新建通道复用）：名单外放行；名单内且该域技能目录
   * 不存在（= 新建）抛 `SkillError(BUILTIN_SKILL_NAME_RESERVED)`；
   * 目录已存在（内置本体 / 历史副本）放行。project 域须带 projectId。
   */
  assertSkillNameNotReservedForCreate(
    domain: SkillDomain,
    name: string,
    projectId?: string
  ): Promise<void>;

  /**
   * 局部修改技能文件（匹配语义复用 normalize-for-match，同 edit 工具）。
   * 与 write 一致须显式域。
   */
  editSkillFile(
    domain: SkillDomain | undefined,
    name: string,
    path: string | undefined,
    match: SkillEditMatch,
    projectId?: string
  ): Promise<{ version: number; replacements: number }>;

  /** 负清单读写：disabled=true 落行、false 删行（只影响当前项目）。 */
  setDisabled(
    projectId: string,
    name: string,
    disabled: boolean
  ): Promise<void>;

  /**
   * 整目录删除技能，连带清理负清单行（global 域清所有项目行）。
   */
  deleteSkill(location: SkillLocation): Promise<void>;

  /**
   * 编辑技能信息（重命名 + 描述同一提交）：单事务完成校验门 → 目录
   * 迁移（renamePrefix，entry_id / revision 历史跟随）→ front matter
   * 同步（parseSkillFrontMatter 成功才重写；invalid 技能跳过重写）→
   * 负清单行迁移。
   *
   * 校验门（撞错抛 SkillError）：newName 须过技能名校验；global 域内置
   * 技能不可改名（`BUILTIN_SKILL_RENAME`，仅改描述放行）；目标名撞内置
   * 保留名且目标目录不存在拒（`BUILTIN_SKILL_NAME_RESERVED`）；域内
   * 已存在目标目录拒（`SKILL_ALREADY_EXISTS`）。仅改描述时不迁目录、
   * 不迁负清单。
   */
  updateSkillInfo(
    location: SkillLocation,
    changes: SkillInfoChanges
  ): Promise<void>;
}
