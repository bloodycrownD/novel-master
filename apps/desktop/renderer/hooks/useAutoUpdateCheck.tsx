/**
 * Background update check: 2s after bootstrap ready, 24h throttle, dismiss per version.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ipcAppCheckForUpdates,
  ipcAppOpenExternal,
  ipcAppUiGet,
  ipcAppUiSet,
} from "../ipc/client";
import { showToast } from "../components/ui/show-toast";
import { UpdateAvailableModal } from "../components/ui/UpdateAvailableModal";
import type { UpdateCheckData } from "../../shared/ipc-types";

const AUTO_CHECK_DELAY_MS = 2000;
/** Minimum interval between automatic checks (24 hours). */
const AUTO_CHECK_THROTTLE_MS = 24 * 60 * 60 * 1000;

const KEY_AUTO_CHECK = "updates.autoCheck";
const KEY_LAST_CHECK_AT = "updates.lastCheckAt";
const KEY_LAST_STATUS = "updates.lastCheckStatus";
const KEY_LAST_REMOTE = "updates.lastCheckRemoteVersion";
const KEY_DISMISSED = "updates.dismissedVersion";

function isThrottled(lastCheckAt: string | undefined): boolean {
  if (!lastCheckAt) return false;
  const last = Date.parse(lastCheckAt);
  if (!Number.isFinite(last)) return false;
  return Date.now() - last < AUTO_CHECK_THROTTLE_MS;
}

export function AutoUpdateCheckHost() {
  const ranRef = useRef(false);
  const [updateModal, setUpdateModal] = useState<UpdateCheckData | null>(null);
  const [modalBusy, setModalBusy] = useState(false);

  const persistCheckResult = useCallback(async (data: UpdateCheckData | null) => {
    const now = new Date().toISOString();
    await ipcAppUiSet(KEY_LAST_CHECK_AT, now);
    if (data) {
      await ipcAppUiSet(KEY_LAST_REMOTE, data.remoteVersion);
      await ipcAppUiSet(
        KEY_LAST_STATUS,
        data.status === "update-available" ? "available" : "up-to-date",
      );
    } else {
      await ipcAppUiSet(KEY_LAST_STATUS, "error");
    }
  }, []);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const timer = setTimeout(() => {
      void (async () => {
        const autoRes = await ipcAppUiGet(KEY_AUTO_CHECK);
        const autoCheck = autoRes.ok ? autoRes.data !== "false" : true;
        if (!autoCheck) return;

        const lastAtRes = await ipcAppUiGet(KEY_LAST_CHECK_AT);
        if (lastAtRes.ok && isThrottled(lastAtRes.data)) return;

        const checkRes = await ipcAppCheckForUpdates();
        if (!checkRes.ok) {
          await persistCheckResult(null);
          return;
        }
        await persistCheckResult(checkRes.data);

        if (checkRes.data.status !== "update-available") return;

        const dismissedRes = await ipcAppUiGet(KEY_DISMISSED);
        const dismissed = dismissedRes.ok ? dismissedRes.data : undefined;
        if (dismissed === checkRes.data.remoteVersion) return;

        showToast(`发现新版本 ${checkRes.data.remoteVersion}`);
        setUpdateModal(checkRes.data);
      })();
    }, AUTO_CHECK_DELAY_MS);

    return () => clearTimeout(timer);
  }, [persistCheckResult]);

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
    <UpdateAvailableModal
      open={updateModal != null}
      remoteVersion={updateModal?.remoteVersion ?? ""}
      releaseNotesExcerpt={updateModal?.releaseNotesExcerpt ?? ""}
      busy={modalBusy}
      onDownload={handleDownload}
      onLater={handleLater}
      onCancel={() => setUpdateModal(null)}
    />
  );
}
