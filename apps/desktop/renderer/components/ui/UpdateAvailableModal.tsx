import { Button } from "./Button";

type UpdateAvailableModalProps = {
  open: boolean;
  remoteVersion: string;
  releaseNotesExcerpt: string;
  busy?: boolean;
  onDownload: () => void | Promise<void>;
  onLater: () => void | Promise<void>;
  onCancel: () => void;
};

export function UpdateAvailableModal({
  open,
  remoteVersion,
  releaseNotesExcerpt,
  busy = false,
  onDownload,
  onLater,
  onCancel,
}: UpdateAvailableModalProps) {
  if (!open) {
    return null;
  }

  const message = releaseNotesExcerpt
    ? `新版本 ${remoteVersion}\n\n${releaseNotesExcerpt}`
    : `新版本 ${remoteVersion}`;

  return (
    <div className="text-prompt-overlay" onClick={onCancel}>
      <div
        className="confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="update-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="update-modal-title" className="confirm-modal__title">
          发现新版本
        </h3>
        <p className="confirm-modal__message" style={{ whiteSpace: "pre-wrap" }}>
          {message}
        </p>
        <div className="confirm-modal__actions">
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            取消
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void onLater()}>
            稍后
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void onDownload()}>
            {busy ? "处理中…" : "前往下载"}
          </Button>
        </div>
      </div>
    </div>
  );
}
