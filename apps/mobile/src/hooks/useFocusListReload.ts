/**
 * 列表屏通用「聚焦即重载」组合（screens/C-1）：rows/loading/error + reload + useFocusEffect。
 *
 * - fetcher 由各屏注入（含各屏自己的富化/副作用逻辑），抛错时默认进 error 态
 *   （清空 rows + formatError 文案，配「重试」UI），而不是吞错伪装成空列表；
 *   原本走 toast 语义的屏（SkillPanel 等）传 onError 自行处理，rows 保持原值。
 * - fetcher 返回 null/undefined 时兜底为 fallbackValue（如路由参数缺失的早退分支）；
 *   fallbackValue 会进 reload 的依赖，须传模块级稳定引用。
 * - focusSilent：聚焦重载不置 loading（不拉下拉指示器、不重建列表视觉），见 SkillPanelScreen 先例。
 */
import {useCallback, useState} from 'react';
import type {Dispatch, SetStateAction} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {formatError} from '../errors/format-error';

export interface UseFocusListReloadOptions<T> {
  /** 数据拉取；抛错由 hook 统一分流（默认进 error 态）。 */
  fetcher: () => Promise<T | null | undefined>;
  /** fetcher 返回 null/undefined 时的兜底值（须为模块级稳定引用）。 */
  fallbackValue: T;
  /** 聚焦重载是否静默（不置 loading）。 */
  focusSilent?: boolean;
  /** 错误处理：不传时进 error 态；传了则走调用方语义（如 toast），rows 保持原值。 */
  onError?: (cause: unknown) => void;
}

export interface FocusListReloadResult<T> {
  rows: T;
  loading: boolean;
  error: string | undefined;
  /** 重新拉取；silent 为 true 时不置 loading（聚焦返回的静默刷新）。 */
  reload: (opts?: {silent?: boolean}) => Promise<void>;
  /** 行集 setter：供行内乐观更新（如开关翻转）直接修改 rows。 */
  setRows: Dispatch<SetStateAction<T>>;
}

export function useFocusListReload<T>({
  fetcher,
  fallbackValue,
  focusSilent = false,
  onError,
}: UseFocusListReloadOptions<T>): FocusListReloadResult<T> {
  const [rows, setRows] = useState<T>(fallbackValue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const reload = useCallback(
    async (opts?: {silent?: boolean}) => {
      if (!opts?.silent) {
        setLoading(true);
      }
      setError(undefined);
      try {
        const next = await fetcher();
        setRows(next ?? fallbackValue);
      } catch (cause) {
        if (onError) {
          onError(cause);
        } else {
          setRows(fallbackValue);
          setError(formatError(cause));
        }
      } finally {
        setLoading(false);
      }
    },
    [fetcher, fallbackValue, onError],
  );

  useFocusEffect(
    useCallback(() => {
      reload(focusSilent ? {silent: true} : undefined).catch(() => undefined);
    }, [reload, focusSilent]),
  );

  return {rows, loading, error, reload, setRows};
}
