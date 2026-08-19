/**
 * Skills service factory.
 *
 * @module service/skills/create-skills-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { createScopedVfsService } from "@/service/vfs/create-scoped-vfs-service.js";
import { SkillsService } from "./impl/skills.service.js";
import type { SkillService } from "./skills.port.js";

/**
 * Creates a {@link SkillService} over both skill domains.
 *
 * 内部持 globalMetaVfs / projectMetaVfs 惰性工厂闭包（对齐 runtime 装配风格），
 * 技能读写经 ScopedVfsService 落 meta 域（global:meta / project:{pid}:meta）
 * 的 `/meta/skills/` 前缀。
 *
 * @param conn - Open connection after {@link bootstrapNovelMaster}
 */
export function createSkillsService(conn: TdbcConnection): SkillService {
  return new SkillsService({
    conn,
    globalMetaVfs: () => createScopedVfsService(conn, { kind: "global-meta" }),
    projectMetaVfs: (projectId) =>
      createScopedVfsService(conn, { kind: "project-meta", projectId }),
  });
}
