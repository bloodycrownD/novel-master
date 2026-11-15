/**
 * Project CRUD IPC handlers.
 */
import type {
  IpcResult,
  ProjectCreateRequest,
  ProjectDeleteRequest,
  ProjectDto,
  ProjectRenameRequest,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { formatIpcError } from "../format-ipc-error.js";
import { ipcErr } from "../ipc-result.js";

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
    if (!project.ok) return ipcErr(formatIpcError(project.error));
    return { ok: true, data: toDto(project.value) };
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
    if (!project.ok) return ipcErr(formatIpcError(project.error));
    return { ok: true, data: toDto(project.value) };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleProjectsDelete(
  req: ProjectDeleteRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    const deleted = await rt.projects.delete(req.id);
    if (!deleted.ok) return ipcErr(formatIpcError(deleted.error));
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
