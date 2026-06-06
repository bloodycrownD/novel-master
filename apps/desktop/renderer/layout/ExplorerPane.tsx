import { useShellNav } from "../providers/ShellNavProvider";
import { workspaceTitleForScope } from "../state/nav-workspace";

export function ExplorerPane() {
  const { workspaceScope } = useShellNav();
  const title = workspaceTitleForScope(workspaceScope);

  return (
    <>
      <header className="column-header" id="explorer-header" aria-label="工作区">
        <span className="column-header__title" id="workspace-title">
          {title}
        </span>
      </header>
      <section id="explorer-pane" aria-label="工作区">
        <div className="workspace-trees">
          {(["global", "session", "chat"] as const).map((scope) => {
            const visible = workspaceScope === scope;
            return (
              <div
                key={scope}
                className={`workspace-tree-panel${visible ? " is-visible" : ""}`}
                data-workspace-panel={scope}
                hidden={!visible}
              >
                <div
                  className="explorer-tree"
                  data-tree={scope}
                  id={`workspace-tree-${scope}`}
                >
                  <p className="tree-empty">加载中…</p>
                </div>
              </div>
            );
          })}
        </div>
        <div id="workspace-footer" className="workspace-footer hidden" hidden>
          <div id="conversation-meta" className="workspace-footer-card" />
        </div>
      </section>
    </>
  );
}
