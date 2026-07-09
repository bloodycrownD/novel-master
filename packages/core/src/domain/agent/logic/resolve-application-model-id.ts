/**
 * @deprecated 请改用 {@link resolveSavedModelId}（M4 命名清债）。
 * @module domain/agent/resolve-application-model-id
 */

export {
  resolveSavedModelId as resolveApplicationModelId,
  resolveSummarySavedModelId as resolveSummaryApplicationModelId,
  type ResolveSavedModelIdInput as ResolveApplicationModelIdInput,
  type ResolveSummarySavedModelIdInput as ResolveSummaryApplicationModelIdInput,
} from "./resolve-saved-model-id.js";
