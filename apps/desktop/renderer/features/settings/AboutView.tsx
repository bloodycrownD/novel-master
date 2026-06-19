import { useCallback, useEffect, useState } from "react";
import appIcon from "@assets/icon.webp";
import {
  ipcAppCheckForUpdates,
  ipcAppGetInfo,
  ipcAppOpenExternal,
  ipcAppUiGet,
  ipcAppUiSet,
} from "@/ipc/client";
import { showToast } from "@/components/ui/show-toast";
import { UpdateAvailableModal } from "@/components/ui/UpdateAvailableModal";
import type { UpdateCheckData } from "@shared/ipc-types";
import { ABOUT_LINKS } from "./about-links";
import {
  SettingsPanel,
  SettingsRow,
  SettingsRows,
  SettingsSection,
  SettingsStatus,
  SettingsSwitchRow,
} from "./settings-ui";

const KEY_AUTO_CHECK = "updates.autoCheck";
const KEY_LAST_STATUS = "updates.lastCheckStatus";
const KEY_LAST_REMOTE = "updates.lastCheckRemoteVersion";
const KEY_DISMISSED = "updates.dismissedVersion";

function formatStatusLabel(status: string | undefined, remote: string | undefined): string {
  if (status === "up-to-date") return "当前已是最新版本";
  if (status === "available" && remote) return `有新版本 ${remote}`;
  if (status === "error") return "上次检查失败";
  return "—";
}

export function AboutView() {
  const [version, setVersion] = useState("—");
  const [autoCheck, setAutoCheck] = useState(true);
  const [lastStatus, setLastStatus] = useState<string | undefined>();
  const [lastRemote, setLastRemote] = useState<string | undefined>();
  const [checking, setChecking] = useState(false);
  const [updateModal, setUpdateModal] = useState<UpdateCheckData | null>(null);
  const [modalBusy, setModalBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [infoRes, autoRes, statusRes, remoteRes] = await Promise.all([
      ipcAppGetInfo(),
      ipcAppUiGet(KEY_AUTO_CHECK),
      ipcAppUiGet(KEY_LAST_STATUS),
      ipcAppUiGet(KEY_LAST_REMOTE),
    ]);
    if (infoRes.ok) {
      setVersion(infoRes.data.version);
    }
    setAutoCheck(autoRes.ok ? autoRes.data !== "false" : true);
    setLastStatus(statusRes.ok ? statusRes.data : undefined);
    setLastRemote(remoteRes.ok ? remoteRes.data : undefined);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const persistSuccessfulCheck = useCallback(async (data: UpdateCheckData) => {
    const now = new Date().toISOString();
    await ipcAppUiSet("updates.lastCheckAt", now);
    await ipcAppUiSet(KEY_LAST_REMOTE, data.remoteVersion);
    await ipcAppUiSet(
      KEY_LAST_STATUS,
      data.status === "update-available" ? "available" : "up-to-date",
    );
    setLastStatus(
      data.status === "update-available" ? "available" : "up-to-date",
    );
    setLastRemote(data.remoteVersion);
  }, []);

  const persistFailedCheck = useCallback(async () => {
    await ipcAppUiSet(KEY_LAST_STATUS, "error");
    setLastStatus("error");
  }, []);

  const runManualCheck = useCallback(async () => {
    setChecking(true);
    try {
      const res = await ipcAppCheckForUpdates();
      if (!res.ok) {
        await persistFailedCheck();
        showToast(res.error.message);
        return;
      }
      await persistSuccessfulCheck(res.data);
      if (res.data.status === "up-to-date") {
        showToast("当前已是最新版本");
        return;
      }
      setUpdateModal(res.data);
    } finally {
      setChecking(false);
    }
  }, [persistFailedCheck, persistSuccessfulCheck]);

  const openLink = useCallback(async (url: string) => {
    const res = await ipcAppOpenExternal(url);
    if (!res.ok) {
      showToast(res.error.message);
    }
  }, []);

  const handleAutoCheckChange = useCallback(async (next: boolean) => {
    setAutoCheck(next);
    const res = await ipcAppUiSet(KEY_AUTO_CHECK, next ? "true" : "false");
    if (!res.ok) {
      showToast(res.error.message);
      setAutoCheck(!next);
    }
  }, []);

  const handleDownload = useCallback(async () => {
    if (!updateModal) return;
    setModalBusy(true);
    try {
      await ipcAppOpenExternal(updateModal.releaseUrl);
      setUpdateModal(null);
    } finally {
      setModalBusy(false);
    }
  }, [updateModal]);

  const handleLater = useCallback(async () => {
    if (!updateModal) return;
    setModalBusy(true);
    try {
      await ipcAppUiSet(KEY_DISMISSED, updateModal.remoteVersion);
      setUpdateModal(null);
    } finally {
      setModalBusy(false);
    }
  }, [updateModal]);

  return (
    <SettingsPanel>
      <div className="about-view__header">
        <img className="about-view__logo" src={appIcon} alt="" width={64} height={64} />
        <h3 className="about-view__title">Novel Master</h3>
        <p className="about-view__version">版本 {version}</p>
      </div>

      <SettingsSection title="更新">
        <SettingsRows>
          <SettingsSwitchRow
            label="自动检查更新"
            checked={autoCheck}
            onChange={(next) => void handleAutoCheckChange(next)}
          />
          <SettingsRow
            label="检查更新"
            value={checking ? "检查中…" : "立即检查"}
            onClick={checking ? undefined : () => void runManualCheck()}
          />
        </SettingsRows>
        <SettingsStatus>
          {formatStatusLabel(lastStatus, lastRemote)}
        </SettingsStatus>
      </SettingsSection>

      <SettingsSection title="项目链接">
        <SettingsRows>
          <SettingsRow
            label="GitHub 仓库"
            value=""
            onClick={() => void openLink(ABOUT_LINKS.repo)}
          />
          <SettingsRow
            label="发行版"
            value=""
            onClick={() => void openLink(ABOUT_LINKS.releases)}
          />
          <SettingsRow
            label="许可证"
            value=""
            onClick={() => void openLink(ABOUT_LINKS.license)}
          />
        </SettingsRows>
      </SettingsSection>

      <UpdateAvailableModal
        open={updateModal != null}
        remoteVersion={updateModal?.remoteVersion ?? ""}
        releaseNotesExcerpt={updateModal?.releaseNotesExcerpt ?? ""}
        busy={modalBusy}
        onDownload={handleDownload}
        onLater={handleLater}
        onCancel={() => setUpdateModal(null)}
      />
    </SettingsPanel>
  );
}
