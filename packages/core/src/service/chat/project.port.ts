/**
 * Project application service port.
 *
 * @module service/chat/project.port
 */

import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";
import type { ValidateAgentDefinitionOptions } from "@/domain/agent/logic/validate-agent-definition.js";
import type { ChatProject } from "@/domain/chat/model/project.js";
import type {
    ProjectAgentConfig,
    ProjectAgentConfigPatch,
} from "@/domain/chat/model/project-agent-config.js";

/** Project CRUD and copy operations. */
export interface ProjectService {
    list(): Promise<ChatProject[]>;

    get(id: string): Promise<Result<ChatProject, AppError>>;

    create(name: string): Promise<Result<ChatProject, AppError>>;

    rename(id: string, name: string): Promise<Result<ChatProject, AppError>>;

    delete(id: string): Promise<Result<void, AppError>>;

    /** Copies project metadata and project-domain template VFS only. */
    copy(id: string): Promise<Result<ChatProject, AppError>>;

    /** 读取项目智能体配置；列 NULL 时返回 `{ mode: "follow" }`。 */
    getAgentConfig(id: string): Promise<Result<ProjectAgentConfig, AppError>>;

    /** 合并 patch、校验并持久化项目智能体配置。 */
    updateAgentConfig(
        id: string,
        patch: ProjectAgentConfigPatch,
        options?: ValidateAgentDefinitionOptions
    ): Promise<Result<ProjectAgentConfig, AppError>>;
}
