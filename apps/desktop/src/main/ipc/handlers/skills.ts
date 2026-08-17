/**
 * Skills IPC handlers：直调 runtime `skills()`（SkillService 端口）。
 *
 * promote 是 copySkill 的封装（project → global），overwrite=false 且
 * 全局已有同名时返回 `SKILL_EXISTS`，由 UI 弹覆盖确认后携 true 重试。
 */
import type {
  EffectiveSkillDto,
  IpcResult,
  SkillListItemDto,
  SkillRefDto,
  SkillsCopyRequest,
  SkillsDeleteRequest,
  SkillsEditRequest,
  SkillsEffectiveRequest,
  SkillsListRequest,
  SkillsPromoteRequest,
  SkillsReadRequest,
  SkillsReadResponse,
  SkillsToggleRequest,
  SkillsWriteRequest,
} from "../../../../shared/ipc-types.js";
import type {
  SkillListScope,
  SkillLocation,
} from "@novel-master/core/skills";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { formatIpcError } from "../ipc-error.js";

function toSkillLocation(ref: SkillRefDto): SkillLocation {
  return {
    domain: ref.domain,
    ...(ref.projectId != null ? { projectId: ref.projectId } : {}),
    name: ref.name,
  };
}

export async function handleSkillsList(
  req: SkillsListRequest,
): Promise<IpcResult<SkillListItemDto[]>> {
  try {
    const rt = await getDesktopRuntime();
    const scope: SkillListScope =
      req.domain === "global"
        ? "global"
        : { projectId: req.projectId ?? "" };
    const items = await rt.skills().listSkills(scope);
    return {
      ok: true,
      data: items.map((item) => ({
        name: item.name,
        description: item.description,
        domain: item.domain,
        valid: item.valid,
        ...(item.invalidReason != null
          ? { invalidReason: item.invalidReason }
          : {}),
        files: [...item.files],
      })),
    };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSkillsEffective(
  req: SkillsEffectiveRequest,
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
          ? { invalidReason: row.invalidReason }
          : {}),
        effective: row.effective,
      })),
    };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSkillsRead(
  req: SkillsReadRequest,
): Promise<IpcResult<SkillsReadResponse>> {
  try {
    const rt = await getDesktopRuntime();
    const file = await rt.skills().readSkillFile(
      req.domain,
      req.name,
      req.path,
      req.projectId,
    );
    return {
      ok: true,
      data: {
        domain: file.domain,
        name: file.name,
        path: file.path,
        content: file.content,
        version: file.version,
      },
    };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSkillsWrite(
  req: SkillsWriteRequest,
): Promise<IpcResult<{ version: number }>> {
  try {
    const rt = await getDesktopRuntime();
    const result = await rt.skills().writeSkillFile(
      req.domain,
      req.name,
      req.path,
      req.content,
      req.projectId,
    );
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSkillsEdit(
  req: SkillsEditRequest,
): Promise<IpcResult<{ version: number; replacements: number }>> {
  try {
    const rt = await getDesktopRuntime();
    const result = await rt.skills().editSkillFile(
      req.domain,
      req.name,
      req.path,
      {
        oldString: req.oldString,
        newString: req.newString,
        ...(req.replaceAll != null ? { replaceAll: req.replaceAll } : {}),
      },
      req.projectId,
    );
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSkillsToggle(
  req: SkillsToggleRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.skills().setDisabled(req.projectId, req.name, req.disabled);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSkillsCopy(
  req: SkillsCopyRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt
      .skills()
      .copySkill(toSkillLocation(req.from), toSkillLocation(req.to));
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSkillsPromote(
  req: SkillsPromoteRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    const service = rt.skills();
    if (!req.overwrite) {
      const globalSkills = await service.listSkills("global");
      if (globalSkills.some((s) => s.name === req.name)) {
        return {
          ok: false,
          error: {
            code: "SKILL_EXISTS",
            message: `全局域已存在同名技能「${req.name}」，覆盖后全局版将被整目录替换。`,
          },
        };
      }
    }
    await service.copySkill(
      { domain: "project", projectId: req.projectId, name: req.name },
      { domain: "global", name: req.name },
    );
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSkillsDelete(
  req: SkillsDeleteRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.skills().deleteSkill(toSkillLocation(req));
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
