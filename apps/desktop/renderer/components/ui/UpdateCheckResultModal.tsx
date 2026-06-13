import { Button } from "./Button";

export type UpdateCheckResultKind = "up-to-date" | "error";

export const UPDATE_CHECK_RESULT_TITLE = "版本检查";
export const UPDATE_CHECK_UP_TO_DATE_MESSAGE = "当前已是最新版本";
export const UPDATE_CHECK_FAILED_MESSAGE = "无法检查更新，请检查网络";

type UpdateCheckResultModalProps = {
  open: boolean;
  kind: UpdateCheckResultKind;
  onClose: () => void;
  onSnoozeToday: () => void | Promise<void>;
};

function messageForKind(kind: UpdateCheckResultKind): string {
  return kind === "up-to-date"
    ? UPDATE_CHECK_UP_TO_DATE_MESSAGE
    : UPDATE_CHECK_FAILED_MESSAGE;
}

export function UpdateCheckResultModal({
  open,
  kind,
  onClose,
  onSnoozeToday,
}: UpdateCheckResultModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="text-prompt-overlay" onClick={onClose}>
      <div
        className="update-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="update-check-result-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="update-check-result-title" className="update-modal__title">
          {UPDATE_CHECK_RESULT_TITLE}
        </h3>
        <p className="update-modal__hint">{messageForKind(kind)}</p>
        <div className="update-modal__actions">
          <Button variant="secondary" onClick={onClose}>
            关闭
          </Button>
          <Button variant="secondary" onClick={() => void onSnoozeToday()}>
            今日不再提醒
          </Button>
        </div>
      </div>
    </div>
  );
}
