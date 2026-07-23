/**
 * Agent 编辑器「常驻工作区」顶卡（section head + Switch + 助手确认语）。
 * 供全局 Agent 与定义表单两处共用；开关与文案均为受控，由调用方传入。
 */
import {
  WORKPLACE_BLOCK_LABEL,
  WORKPLACE_BLOCK_HINT,
  WORKPLACE_ASSISTANT_TEXT_LABEL,
} from "@shared/logic/config-forms-agent";
import { Switch } from "@/components/ui/Switch";
import { SettingsField } from "./settings-ui";

type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** 助手确认语（对齐 system 区受控 `value`）。 */
  assistantText: string;
  /** 助手确认语变更（对齐 system 区受控 `onChange`）。 */
  onAssistantTextChange: (next: string) => void;
};

export function AgentWorkplaceBlockCard({
  checked,
  onChange,
  disabled,
  assistantText,
  onAssistantTextChange,
}: Props) {
  return (
    <>
      <div className="config-block-card__section-head">
        <span className="config-block-card__section-label">
          {WORKPLACE_BLOCK_LABEL}
        </span>
      </div>
      <div className="config-block-card config-block-card--prompt">
        <div className="config-block-card__header">
          <span className="config-block-card__badge">
            {WORKPLACE_BLOCK_LABEL}
          </span>
          <Switch
            checked={checked}
            disabled={disabled}
            onChange={onChange}
            aria-label={WORKPLACE_BLOCK_LABEL}
          />
        </div>
        <div className="config-block-card__body">
          {checked ? (
            <>
              <p className="config-block-card__hint">{WORKPLACE_BLOCK_HINT}</p>
              <SettingsField label={WORKPLACE_ASSISTANT_TEXT_LABEL}>
                <textarea
                  rows={3}
                  value={assistantText}
                  disabled={disabled}
                  onChange={(e) => onAssistantTextChange(e.target.value)}
                  aria-label={WORKPLACE_ASSISTANT_TEXT_LABEL}
                />
              </SettingsField>
            </>
          ) : (
            <p className="config-block-card__hint">
              关闭时不注入项目文件树。
            </p>
          )}
        </div>
      </div>
    </>
  );
}
