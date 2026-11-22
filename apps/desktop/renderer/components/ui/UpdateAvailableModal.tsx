import { coreT } from "@shared/logic/core-i18n";
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
                    {coreT({key: "ui.update.available_title"})}
                </h3>
                <p className="update-modal__version">v{remoteVersion}</p>
                {releaseNotesExcerpt ? (
                    <p className="update-modal__notes">{releaseNotesExcerpt}</p>
                ) : null}
                <p className="update-modal__hint">
                    {coreT({key: "ui.update.open_releases_hint"})}
                </p>
                <div className="update-modal__actions">
                    <Button variant="secondary" disabled={busy} onClick={onCancel}>
                        {coreT({key: "ui.common.cancel"})}
                    </Button>
                    <Button variant="secondary" disabled={busy} onClick={() => void onLater()}>
                        {coreT({key: "ui.update.later"})}
                    </Button>
                    <Button variant="primary" disabled={busy} onClick={() => void onDownload()}>
                        {busy ? coreT({key: "ui.common.processing"}) : coreT({key: "ui.update.go_download"})}
                    </Button>
                </div>
            </div>
        </div>
    );
}
