import { coreT } from "@shared/logic/core-i18n";
import { Button } from "./Button";

export type UpdateCheckResultKind = "up-to-date" | "error";

const UPDATE_CHECK_RESULT_TITLE = () => coreT({key: "ui.update.check_title"});
const UPDATE_CHECK_UP_TO_DATE_MESSAGE = () => coreT({key: "ui.update.up_to_date"});
const UPDATE_CHECK_FAILED_MESSAGE = () => coreT({key: "ui.update.check_failed"});

type UpdateCheckResultModalProps = {
  open: boolean;
  kind: UpdateCheckResultKind;
  onClose: () => void;
  onSnoozeToday: () => void | Promise<void>;
};

function messageForKind(kind: UpdateCheckResultKind): string {
  return kind === "up-to-date"
    ? UPDATE_CHECK_UP_TO_DATE_MESSAGE()
    : UPDATE_CHECK_FAILED_MESSAGE();
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
          {UPDATE_CHECK_RESULT_TITLE()}
        </h3>
        <p className="update-modal__hint">{messageForKind(kind)}</p>
        <div className="update-modal__actions update-modal__actions--between">
          <Button variant="secondary" onClick={onClose}>
            {coreT({key: "ui.common.close"})}
          </Button>
          <Button variant="secondary" onClick={() => void onSnoozeToday()}>
            {coreT({key: "ui.update.remind_off_today"})}
          </Button>
        </div>
      </div>
    </div>
  );
}
