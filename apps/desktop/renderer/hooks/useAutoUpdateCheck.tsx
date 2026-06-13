/**
 * Background update check: 2s after bootstrap ready, first-screen result modal.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ipcAppCheckForUpdates,
  ipcAppOpenExternal,
  ipcAppUiGet,
  ipcAppUiSet,
} from "../ipc/client";
import { showToast } from "../components/ui/show-toast";
import {
  UpdateCheckResultModal,
  type UpdateCheckResultKind,
} from "../components/ui/UpdateCheckResultModal";
import { UpdateAvailableModal } from "../components/ui/UpdateAvailableModal";
import { DESKTOP_UI_KEY_UPDATES_SNOOZE_UNTIL } from "../../src/main/storage/app-ui-prefs";
import type { UpdateCheckData } from "../../shared/ipc-types";

const AUTO_CHECK_DELAY_MS = 2000;
const UPDATE_TOAST_MS = 8000;
const UPDATE_SNOOZE_MS = 24 * 60 * 60 * 1000;

const KEY_AUTO_CHECK = "updates.autoCheck";
const KEY_LAST_CHECK_AT = "updates.lastCheckAt";
const KEY_LAST_STATUS = "updates.lastCheckStatus";
const KEY_LAST_REMOTE = "updates.lastCheckRemoteVersion";
const KEY_DISMISSED = "updates.dismissedVersion";

function isSnoozed(snoozeUntil: string | undefined): boolean {
  if (!snoozeUntil) return false;
  const until = Date.parse(snoozeUntil);
  if (!Number.isFinite(until)) return false;
  return Date.now() < until;
}

async function readSnoozeUntil(): Promise<string | undefined> {
  const res = await ipcAppUiGet(DESKTOP_UI_KEY_UPDATES_SNOOZE_UNTIL);
  return res.ok ? res.data : undefined;
}

async function writeSnoozeUntil(): Promise<void> {
  const until = new Date(Date.now() + UPDATE_SNOOZE_MS).toISOString();
  await ipcAppUiSet(DESKTOP_UI_KEY_UPDATES_SNOOZE_UNTIL, until);
}

async function persistSuccessfulCheck(data: UpdateCheckData): Promise<void> {
  const now = new Date().toISOString();
  await ipcAppUiSet(KEY_LAST_CHECK_AT, now);
  await ipcAppUiSet(KEY_LAST_REMOTE, data.remoteVersion);
  await ipcAppUiSet(
    KEY_LAST_STATUS,
    data.status === "update-available" ? "available" : "up-to-date",
  );
}

async function persistFailedCheck(): Promise<void> {
  await ipcAppUiSet(KEY_LAST_STATUS, "error");
}

export function AutoUpdateCheckHost() {
  const ranRef = useRef(false);
  const [updateModal, setUpdateModal] = useState<UpdateCheckData | null>(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [resultModal, setResultModal] = useState<UpdateCheckResultKind | null>(
    null,
  );

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const timer = setTimeout(() => {
      void (async () => {
        const autoRes = await ipcAppUiGet(KEY_AUTO_CHECK);
        const autoCheck = autoRes.ok ? autoRes.data !== "false" : true;
        if (!autoCheck) return;

        const snoozeUntil = await readSnoozeUntil();
        const snoozed = isSnoozed(snoozeUntil);

        let checkRes;
        try {
          checkRes = await ipcAppCheckForUpdates();
        } catch {
          await persistFailedCheck();
          if (!snoozed) {
            setResultModal("error");
          }
          return;
        }
        if (!checkRes.ok) {
          await persistFailedCheck();
          if (!snoozed) {
            setResultModal("error");
          }
          return;
        }
        await persistSuccessfulCheck(checkRes.data);

        if (snoozed) return;

        if (checkRes.data.status === "up-to-date") {
          setResultModal("up-to-date");
          return;
        }

        if (checkRes.data.status !== "update-available") return;

        const dismissedRes = await ipcAppUiGet(KEY_DISMISSED);
        const dismissed = dismissedRes.ok ? dismissedRes.data : undefined;
        if (dismissed === checkRes.data.remoteVersion) return;

        const updateData = checkRes.data;
        showToast(`发现新版本 ${updateData.remoteVersion}`, UPDATE_TOAST_MS, {
          actionLabel: "查看",
          onAction: () => setUpdateModal(updateData),
        });
      })();
    }, AUTO_CHECK_DELAY_MS);

    return () => clearTimeout(timer);
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

  const handleCloseResultModal = useCallback(() => {
    setResultModal(null);
  }, []);

  const handleSnoozeToday = useCallback(async () => {
    await writeSnoozeUntil();
    setResultModal(null);
  }, []);

  return (
    <>
      <UpdateCheckResultModal
        open={resultModal != null}
        kind={resultModal ?? "up-to-date"}
        onClose={handleCloseResultModal}
        onSnoozeToday={handleSnoozeToday}
      />
      <UpdateAvailableModal
        open={updateModal != null}
        remoteVersion={updateModal?.remoteVersion ?? ""}
        releaseNotesExcerpt={updateModal?.releaseNotesExcerpt ?? ""}
        busy={modalBusy}
        onDownload={handleDownload}
        onLater={handleLater}
        onCancel={() => setUpdateModal(null)}
      />
    </>
  );
}
