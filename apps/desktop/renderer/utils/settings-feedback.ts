import { showToast } from "../components/ui/show-toast";
import { formatUserError } from "./format-user-error";

export function toastSettingsSuccess(message: string): void {
  showToast(message);
}

export function toastSettingsError(message: string): void {
  showToast(formatUserError(message));
}
