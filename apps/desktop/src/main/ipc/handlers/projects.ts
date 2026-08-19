/**
 * Project CRUD IPC handlers.
 */
import type {
  IpcResult,
  ProjectAgentConfigDto,
  ProjectCreateRequest,
  ProjectDeleteRequest,
  ProjectDto,
  ProjectGetAgentConfigRequest,
  ProjectRenameRequest,
  ProjectUpdateAgentConfigRequest,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { formatIpcError } from "../format-ipc-error.js";

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

/**
 * 读取项目智能体配置（项目智能体已下线，恒返回 follow 默认）。
 * @deprecated 项目智能体功能已下线，保留 handler 以兼容外部脚本调用，列数据由迁移置空。
 */
export async function handleProjectsGetAgentConfig(
  _req: ProjectGetAgentConfigRequest,
): Promise<IpcResult<ProjectAgentConfigDto>> {
  try {
    // 项目智能体已下线：恒返回 follow 默认，不读取列内残留数据。
    return { ok: true, data: { mode: "follow" } };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

/**
 * 更新项目智能体配置（项目智能体已下线，no-op）。
 * @deprecated 项目智能体功能已下线，保留 handler 以兼容外部脚本调用，恒返回 follow 默认。
 */
export async function handleProjectsUpdateAgentConfig(
  req: ProjectUpdateAgentConfigRequest,
): Promise<IpcResult<ProjectAgentConfigDto>> {
  try {
    void req;
    console.warn(
      "[nm-desktop] projects.updateAgentConfig called but project agent feature is removed; returning follow default.",
    );
    return { ok: true, data: { mode: "follow" } };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
