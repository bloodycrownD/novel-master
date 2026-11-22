/**
 * Template pull service factory.
 *
 * @module service/template/create-template-pull-service
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { DefaultTemplatePullService } from "./impl/template-pull.service.js";
import type { TemplatePullService } from "./template-pull.port.js";

/** Template pull service 工厂集合。 */
export const TemplatePullServiceFactory = {
    /**
   * Creates a {@link TemplatePullService} for the given connection.
   *
   * nm-style: keep-public — 公共 barrel（@novel-master/core/workplace）暴露的装配入口，11 处测试经它构造服务；
   * 生产侧 chat session.service 也经本工厂调用（不再直接 new impl）。撤导出需同步 barrel 与测试。
   */
    create(conn: TdbcConnection): TemplatePullService {
        return new DefaultTemplatePullService(conn);
    },
} as const;
