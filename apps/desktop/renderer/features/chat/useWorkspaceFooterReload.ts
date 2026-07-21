/**
 * 强制重挂 WorkspaceFooter / 重拉 token IPC。
 */
import { useCallback, useState } from "react";

export function useWorkspaceFooterReload(): {
  reloadFooter: () => void;
  footerKey: number;
} {
  const [footerKey, setFooterKey] = useState(0);
  const reloadFooter = useCallback(() => setFooterKey((k) => k + 1), []);
  return { reloadFooter, footerKey };
}
