/**
 * Mobile 划词批注入口门闩（P1-D2）：仅预览态 + 聊天会话工作区。
 */

type FileAnnotateScopeKind =
    | 'global'
    | 'project'
    | 'session'
    | 'skill'
    | 'physical';

export namespace FileAnnotateGate {
    /**
   * 是否挂载划词批注入口。
   * - 仅 `previewMode === true`
   * - 仅 `scopeKind === "session"` 且有 sessionId
   * - project / global / skill / physical / 编辑态 → false
   */
    export function shouldEnable(input: {
        readonly previewMode: boolean;
        readonly scopeKind: FileAnnotateScopeKind;
        readonly sessionId?: string;
    }): boolean {
        return (
            input.previewMode === true &&
            input.scopeKind === 'session' &&
            typeof input.sessionId === 'string' &&
            input.sessionId.length > 0
        );
    }
}
