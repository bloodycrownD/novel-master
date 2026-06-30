/**
 * 订阅 main 进程 agentActive refcount（工具卡「执行中」等，与 uiRunning 分离）。
 */
import { useEffect, useState } from "react";
import { ipcAgentActivityGet, onAgentActivity } from "@/ipc/client";

export function useDesktopAgentActive(): boolean {
  const [agentActive, setAgentActive] = useState(false);

  useEffect(() => {
    void ipcAgentActivityGet()
      .then((payload) => setAgentActive(payload.active))
      .catch(() => undefined);
    return onAgentActivity((payload) => setAgentActive(payload.active));
  }, []);

  return agentActive;
}
