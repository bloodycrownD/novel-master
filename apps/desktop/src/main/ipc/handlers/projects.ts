/**
 * Project CRUD IPC handlers.
 */
import type { ProjectAgentConfigPatch } from "@novel-master/core/chat";
import { resolveAgentDefinitionFromStorage } from "@novel-master/core/config-forms/stored-config-validity";
import type {
  IpcResult,
  ProjectAgentConfigDto,
  ProjectCreateRequest,
  ProjectDeleteRequest,
  ProjectDto,
  ProjectGetAgentConfigRequest,
  ProjectPullTemplateRequest,
  ProjectRenameRequest,
  ProjectUpdateAgentConfigRequest,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { formatIpcError } from "../format-ipc-error.js";
import { toStoredConfigHealthDto } from "./stored-config-health-dto.js";

function toDto(project: {
  id: string;
  name: string;
  createdAtMs: number;
  updatedAtMs: number;
}): ProjectDto {
  return {
    id: project.id,
    name: project.name,
    createdAtMs: project.createdAtMs,
    updatedAtMs: project.updatedAtMs,
  };
}

export async function handleProjectsList(): Promise<IpcResult<ProjectDto[]>> {
  try {
    const rt = await getDesktopRuntime();
    const projects = await rt.projects.list();
    return { ok: true, data: projects.map(toDto) };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleProjectsCreate(
  req: ProjectCreateRequest,
): Promise<IpcResult<ProjectDto>> {
  try {
    const rt = await getDesktopRuntime();
    const project = await rt.projects.create(req.name);
    return { ok: true, data: toDto(project) };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleProjectsRename(
  req: ProjectRenameRequest,
): Promise<IpcResult<ProjectDto>> {
  try {
    const rt = await getDesktopRuntime();
    const project = await rt.projects.rename(req.id, req.name);
    return { ok: true, data: toDto(project) };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleProjectsDelete(
  req: ProjectDeleteRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.projects.delete(req.id);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleProjectsPullTemplate(
  req: ProjectPullTemplateRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.projects.pullTemplate(req.projectId);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

function toAgentConfigDto(config: {
  mode: "follow" | "custom";
  definition?: unknown;
}): ProjectAgentConfigDto {
  if (config.definition === undefined) {
    return { mode: config.mode };
  }
  const health = resolveAgentDefinitionFromStorage(config.definition);
  return {
    mode: config.mode,
    definition: toStoredConfigHealthDto(health) as ProjectAgentConfigDto["definition"],
  };
}

/** 读取项目智能体配置。 */
export async function handleProjectsGetAgentConfig(
  req: ProjectGetAgentConfigRequest,
): Promise<IpcResult<ProjectAgentConfigDto>> {
  try {
    const rt = await getDesktopRuntime();
    const config = await rt.projects.getAgentConfig(req.projectId);
    return { ok: true, data: toAgentConfigDto(config) };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

/** 更新项目智能体配置（不写全局 registry）。 */
export async function handleProjectsUpdateAgentConfig(
  req: ProjectUpdateAgentConfigRequest,
): Promise<IpcResult<ProjectAgentConfigDto>> {
  try {
    const rt = await getDesktopRuntime();
    const patch: ProjectAgentConfigPatch = {
      ...(req.patch.mode !== undefined ? { mode: req.patch.mode } : {}),
      ...(req.patch.definition !== undefined
        ? { definition: req.patch.definition as ProjectAgentConfigPatch["definition"] }
        : {}),
    };
    const config = await rt.projects.updateAgentConfig(req.projectId, patch);
    return { ok: true, data: toAgentConfigDto(config) };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
