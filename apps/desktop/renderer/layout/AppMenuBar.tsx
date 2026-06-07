import { useCallback } from "react";
import { ipcShellMenuPopup } from "../ipc/client";
import { showToast } from "../components/ui/show-toast";
import type { IpcResult, ShellMenuId } from "../../shared/ipc-types";

const MENU_ITEMS: ReadonlyArray<{ id: ShellMenuId; label: string }> = [
  { id: "file", label: "文件" },
  { id: "edit", label: "编辑" },
  { id: "view", label: "视图" },
  { id: "window", label: "窗口" },
  { id: "help", label: "帮助" },
];

export function AppMenuBar() {
  const openMenu = useCallback((menuId: ShellMenuId, anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    void ipcShellMenuPopup({
      menuId,
      x: rect.left,
      y: rect.bottom,
    }).then((res: IpcResult<null>) => {
      if (!res.ok) showToast(res.error.message);
    });
  }, []);

  return (
    <nav className="app-chrome__menubar" aria-label="应用菜单">
      {MENU_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className="app-chrome__menu-btn"
          onClick={(e) => openMenu(item.id, e.currentTarget)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
