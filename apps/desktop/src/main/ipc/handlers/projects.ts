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
import { Result } from "@novel-master/core/errors";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { toIpcResult } from "../ipc-result.js";

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

export function handleProjectsList(): Promise<IpcResult<ProjectDto[]>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    const projects = await rt.projects.list();
    return Result.ok(projects.map(toDto));
  });
}

export function handleProjectsCreate(req: ProjectCreateRequest): Promise<IpcResult<ProjectDto>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    const project = await rt.projects.create(req.name);
    return project.map(toDto);
  });
}

export function handleProjectsRename(req: ProjectRenameRequest): Promise<IpcResult<ProjectDto>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    const project = await rt.projects.rename(req.id, req.name);
    return project.map(toDto);
  });
}

export function handleProjectsDelete(req: ProjectDeleteRequest): Promise<IpcResult<void>> {
  return toIpcResult(async () => {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    return rt.projects.delete(req.id);
  });
}
