import type { LlmProvider } from "@/domain/provider/model/provider.js";
import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";
import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";

export interface CreateProviderInput {
  readonly protocol: LlmProtocolKind;
  readonly baseUrl: string;
  /** trim 后非空，否则 INVALID_ARGUMENT。 */
  readonly displayName: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** 自定义参数：原样合并进请求体顶层；缺省 {}。 */
  readonly bodyParams?: Readonly<Record<string, unknown>>;
  readonly apiKey?: string;
}

export interface EditProviderPatch {
  readonly protocol?: LlmProtocolKind;
  readonly baseUrl?: string;
  /** 若出现则 trim 后必须非空（禁止写回 null / 空白）。 */
  readonly displayName?: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** 显式空对象 {} 可清空（区别于不传=保留原值）。 */
  readonly bodyParams?: Readonly<Record<string, unknown>>;
  readonly apiKey?: string;
}

export interface ProviderListItem extends LlmProvider {
  readonly apiKeyStatus: "set" | "not set";
}

export interface ProviderService {
  list(): Promise<ProviderListItem[]>;
  /** 已知失败走返回值（五期门⑦）：NOT_FOUND 收 `Result.err`；未知异常仍抛。 */
  get(id: string): Promise<Result<LlmProvider, AppError>>;
  /** 已知失败走返回值（四期门⑦）：域校验 / 跨资源写失败收 `Result.err`；未知异常仍抛。 */
  create(input: CreateProviderInput): Promise<Result<LlmProvider, AppError>>;
  /** 已知失败走返回值（四期门⑦）。 */
  edit(id: string, patch: EditProviderPatch): Promise<Result<LlmProvider, AppError>>;
  /** 已知失败走返回值（四期门⑦）。 */
  delete(id: string): Promise<Result<void, AppError>>;
}
