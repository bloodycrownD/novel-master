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

  return (
    <div className="text-prompt-overlay" onClick={onCancel}>
      <div
        className="update-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="update-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="update-modal-title" className="update-modal__title">
          发现新版本
        </h3>
        <p className="update-modal__version">v{remoteVersion}</p>
        {releaseNotesExcerpt ? (
          <p className="update-modal__notes">{releaseNotesExcerpt}</p>
        ) : null}
        <p className="update-modal__hint">
          将在浏览器中打开 GitHub 发行页，请下载对应平台的安装包。
        </p>
        <div className="update-modal__actions">
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
