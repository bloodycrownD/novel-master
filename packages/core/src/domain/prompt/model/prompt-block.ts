/**
 * Prompt block model (text and chat segments).
 *
 * @module domain/prompt/model/prompt-block
 */

// 注：常驻开关（lifecycle always/once）已下线，动态区一律 once 语义（仅 step 0 注入），
// 域模型不再保留 lifecycle 字段；存量定义里的 lifecycle 键由 schema preprocess 静默剥除。
