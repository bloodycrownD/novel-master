/**
 * Template pull service port.
 *
 * Project → session：镜像 project 模板、映射 worktree，
 * 并清空 session-fs 数据（不含消息）。
 *
 * session → project：推送链（镜像拉取，用当前 session 工作区整树覆盖
 * project 模板；方向相反，也无 checkpoint 清理）。
 *
 * global → project 的模板拉取链已随全局文件管理器迭代拆除
 * （项目模板直接在 project 域维护，不再从 global 镜像）。
 *
 * @module service/template/template-pull.port
 */
import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";

export interface TemplatePullService {
  /** 用 project 模板整树覆盖 session 工作区；会话存在性校验的唯一落点。 */
  pullSessionTemplate(sessionId: string): Promise<Result<void, AppError>>;

  /** 用当前 session 工作区（文件 + workplace 规则）整树覆盖 project 模板。 */
  pushSessionTemplate(sessionId: string): Promise<Result<void, AppError>>;
}
