/**
 * Skills IPC handlers：直调 runtime `skills()`（SkillService 端口）。
 */
import type {
  EffectiveSkillDto,
  IpcResult,
  SkillListItemDto,
  SkillRefDto,
  SkillsAssertCreateNameRequest,
  SkillsDeleteRequest,
  SkillsEffectiveRequest,
  SkillsListRequest,
  SkillsReadRequest,
  SkillsReadResponse,
  SkillsToggleRequest,
  SkillsUpdateInfoRequest,
  SkillsWriteRequest,
} from "../../../../shared/ipc-types.js";
import type { SkillListScope, SkillLocation } from "@novel-master/core/skills";
import { coreT } from "../../../../shared/logic/core-i18n.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { formatIpcError } from "../ipc-error.js";
import { ipcErr } from "../ipc-result.js";

function toSkillLocation(ref: SkillRefDto): SkillLocation {
  return {
    domain: ref.domain,
    ...(ref.projectId != null ? { projectId: ref.projectId } : {}),
    name: ref.name,
  };
}

export async function handleSkillsList(
  req: SkillsListRequest
): Promise<IpcResult<SkillListItemDto[]>> {
  try {
    const rt = await getDesktopRuntime();
    const scope: SkillListScope =
      req.domain === "global" ? "global" : { projectId: req.projectId ?? "" };
    const items = await rt.skills().listSkills(scope);
    return {
      ok: true,
      data: items.map((item) => ({
        name: item.name,
        description: item.description,
        domain: item.domain,
        valid: item.valid,
        ...(item.invalidReason != null
          ? { invalidReason: coreT(item.invalidReason) }
          : {}),
        files: [...item.files],
      })),
    };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSkillsEffective(
  req: SkillsEffectiveRequest
): Promise<IpcResult<EffectiveSkillDto[]>> {
  try {
    const rt = await getDesktopRuntime();
    const rows = await rt.skills().effectiveSkills(req.projectId);
    return {
      ok: true,
      data: rows.map((row) => ({
        name: row.name,
        description: row.description,
        domain: row.domain,
        overridden: row.overridden,
        disabled: row.disabled,
        valid: row.valid,
        ...(row.invalidReason != null
          ? { invalidReason: coreT(row.invalidReason) }
          : {}),
        effective: row.effective,
      })),
    };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSkillsRead(
  req: SkillsReadRequest
): Promise<IpcResult<SkillsReadResponse>> {
  try {
    const rt = await getDesktopRuntime();
    const file = await rt
      .skills()
      .readSkillFile(req.domain, req.name, req.path, req.projectId);
    if (!file.ok) return ipcErr(formatIpcError(file.error));
    return {
      ok: true,
      data: {
        domain: file.value.domain,
        name: file.value.name,
        path: file.value.path,
        content: file.value.content,
        version: file.value.version,
      },
    };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSkillsWrite(
  req: SkillsWriteRequest
): Promise<IpcResult<{ version: number }>> {
  try {
    const rt = await getDesktopRuntime();
    const result = await rt
      .skills()
      .writeSkillFile(
        req.domain,
        req.name,
        req.path,
        req.content,
        req.projectId
      );
    if (!result.ok) return ipcErr(formatIpcError(result.error));
    return { ok: true, data: result.value };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSkillsToggle(
  req: SkillsToggleRequest
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    // 已知失败沿 Result 到达，就地转码（错误通道迁移四期）。
    const toggled = await rt
      .skills()
      .setDisabled(req.projectId, req.name, req.disabled);
    if (!toggled.ok) return ipcErr(formatIpcError(toggled.error));
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSkillsDelete(
  req: SkillsDeleteRequest
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    // 已知失败沿 Result 到达，就地转码（错误通道迁移四期）。
    const deleted = await rt.skills().deleteSkill(toSkillLocation(req));
    if (!deleted.ok) return ipcErr(formatIpcError(deleted.error));
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

/** 新建前保留名校验（D2② 门独立暴露）：拒绝时 message 已是中文文案。 */
export async function handleSkillsAssertCreateName(
  req: SkillsAssertCreateNameRequest
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    // 已知失败沿 Result 到达，就地转码（错误通道迁移四期；三期门⑦口径不变）。
    const asserted = await rt
      .skills()
      .assertSkillNameNotReservedForCreate(req.domain, req.name, req.projectId);
    if (!asserted.ok) return ipcErr(formatIpcError(asserted.error));
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

/** 编辑技能信息（重命名 + 描述同一提交）：错误码与中文文案透传。 */
export async function handleSkillsUpdateInfo(
  req: SkillsUpdateInfoRequest
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    // 已知失败沿 Result 到达，就地转码（错误通道迁移四期）。
    const updated = await rt.skills().updateSkillInfo(toSkillLocation(req), {
      ...(req.newName != null ? { newName: req.newName } : {}),
      ...(req.description != null ? { description: req.description } : {}),
    });
    if (!updated.ok) return ipcErr(formatIpcError(updated.error));
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
