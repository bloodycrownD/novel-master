/**
 * 智能体编辑器「常驻工作区」顶卡（section head + Switch + 助手确认语）。
 * 供全局智能体与定义表单两处共用；开关与文案均为受控，由调用方传入。
 */
import {
  WORKPLACE_BLOCK_LABEL,
  WORKPLACE_BLOCK_HINT,
  WORKPLACE_DISABLED_HINT,
  WORKPLACE_ASSISTANT_TEXT_LABEL,
} from "@shared/logic/config-forms-agent";
import { Switch } from "@/components/ui/Switch";
import { PromptCollapsibleField } from "./PromptCollapsibleField";
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
              {/* 只读态（内置 general）不说「可编辑」，避免禁用控件与文案矛盾 */}
              <p className="config-block-card__hint">
                {disabled ? "助手确认语（只读）。" : WORKPLACE_BLOCK_HINT}
              </p>
              <SettingsField label={WORKPLACE_ASSISTANT_TEXT_LABEL}>
                <PromptCollapsibleField
                  value={assistantText}
                  onChange={onAssistantTextChange}
                  ariaLabel={WORKPLACE_ASSISTANT_TEXT_LABEL}
                  disabled={disabled}
                >
                  <textarea
                    rows={3}
                    value={assistantText}
                    disabled={disabled}
                    onChange={(e) => onAssistantTextChange(e.target.value)}
                    aria-label={WORKPLACE_ASSISTANT_TEXT_LABEL}
                  />
                </PromptCollapsibleField>
              </SettingsField>
            </>
          ) : (
            <p className="config-block-card__hint">{WORKPLACE_DISABLED_HINT}</p>
          )}
        </div>
      </div>
    </>
  );
}
