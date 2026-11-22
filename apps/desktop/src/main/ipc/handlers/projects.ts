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
import { DesktopRuntimeSingleton } from "../../runtime/desktop-runtime-singleton.js";
import { IpcResults } from "../ipc-result.js";

export const Projects = {
    toDto(project: {
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
    },

    list(): Promise<IpcResult<ProjectDto[]>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            const projects = await rt.projects.list();
            return Result.ok(projects.map(Projects.toDto));
        });
    },

    create(req: ProjectCreateRequest): Promise<IpcResult<ProjectDto>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            const project = await rt.projects.create(req.name);
            return project.map(Projects.toDto);
        });
    },

    rename(req: ProjectRenameRequest): Promise<IpcResult<ProjectDto>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            const project = await rt.projects.rename(req.id, req.name);
            return project.map(Projects.toDto);
        });
    },

    delete(req: ProjectDeleteRequest): Promise<IpcResult<void>> {
        return IpcResults.from(async () => {
            const built = await DesktopRuntimeSingleton.get();
            // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
            if (!built.ok) return Result.err(built.error);
            const rt = built.value;
            return rt.projects.delete(req.id);
        });
    },
} as const;
