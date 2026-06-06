/**
 * Project CRUD IPC handlers.
 */
import type {
  IpcResult,
  ProjectCreateRequest,
  ProjectDeleteRequest,
  ProjectDto,
  ProjectPullTemplateRequest,
  ProjectRenameRequest,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";

function formatError(err: unknown): { code: string; message: string } {
  if (err instanceof Error) {
    return { code: err.name || "ERROR", message: err.message };
  }
  return { code: "ERROR", message: String(err) };
}

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
    return { ok: false, error: formatError(err) };
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
    return { ok: false, error: formatError(err) };
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
    return { ok: false, error: formatError(err) };
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
    return { ok: false, error: formatError(err) };
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
    return { ok: false, error: formatError(err) };
  }
}
