/**
 * Agent 编辑器「常驻工作区」顶卡（section head + Switch）。
 * 供全局 Agent 与定义表单两处共用，行为与接线由调用方传入 checked/onChange。
 */
import {
  WORKPLACE_BLOCK_LABEL,
  WORKPLACE_BLOCK_HINT,
} from "@novel-master/core/config-forms/agent";
import { Switch } from "@/components/ui/Switch";

type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
};

export function AgentWorkplaceBlockCard({
  checked,
  onChange,
  disabled,
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
            <p className="config-block-card__hint">{WORKPLACE_BLOCK_HINT}</p>
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
