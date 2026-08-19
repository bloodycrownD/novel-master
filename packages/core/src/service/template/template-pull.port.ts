/**
 * Template pull service port.
 *
 * @module service/template/template-pull.port
 */

/**
 * Project → session：镜像 project 模板、映射 worktree，
 * 并清空 session-fs 数据（不含消息）。
 *
 * global → project 的模板拉取链已随全局文件管理器迭代拆除
 * （项目模板直接在 project 域维护，不再从 global 镜像）。
 */
export interface TemplatePullService {
  sessionTemplatePull(sessionId: string): Promise<void>;
}
