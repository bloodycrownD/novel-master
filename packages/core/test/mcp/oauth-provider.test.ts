import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { auth, type FetchLike } from "@modelcontextprotocol/client";
import type { McpServerConfig } from "../../src/domain/mcp/model/mcp-server-config.js";
import { McpSecretRefs } from "../../src/domain/mcp/ports/mcp-config-store.port.js";
import { unwrap, unwrapErr } from "../helpers/result-unwrap.js";
import type { SecretStore } from "../../src/infra/sksp/ports/secret-store.port.js";
import { McpOAuthFactory, McpOAuthProvider } from "../../src/infra/mcp/impl/mcp-oauth-provider.js";

/** 内存 fake SecretStore：明文落 Map，断言直接读（照 store-config.test.ts 先例）。 */
function fakeSecretStore(): SecretStore & { readonly map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
        map,
        async has(ref) {
            return map.has(ref);
        },
        async get(ref) {
            return map.get(ref) ?? null;
        },
        async set(ref, plain) {
            map.set(ref, plain);
        },
        async delete(ref) {
            return map.delete(ref);
        },
    };
}

/** http + oauth 形态 fixture（各用例在此基础上做单点变体）。 */
function oauthConfig(id = "svc", url = SERVER_URL): McpServerConfig {
    return { id, name: id, enabled: true, transport: { type: "http", url }, timeoutMs: 120000, auth: { type: "oauth" } };
}

/** 预置 `mcp/{serverId}/oauth` 单键的持久化字段（JSON 写进 fake SKSP）。 */
function seed(store: SecretStore & { readonly map: Map<string, string> }, fields: Record<string, unknown>): void {
    store.map.set(McpSecretRefs.oauth("svc"), JSON.stringify(fields));
}

/** 读回单键持久化 JSON（断言 SKSP 落库内容用）。 */
function persistedOf(store: SecretStore & { readonly map: Map<string, string> }): Record<string, unknown> {
    const raw = store.map.get(McpSecretRefs.oauth("svc"));
    assert.ok(typeof raw === "string", "SKSP 里没有 oauth 单键");
    return JSON.parse(raw) as Record<string, unknown>;
}

/** 只接 token 端点的 mock fetch（discovery / DCR 由预置的 discovery / client 字段跳过）：返回新 token 对。 */
function tokenFetch(accessToken: string, refreshToken: string): FetchLike {
    return async (url, init) => {
        assert.equal(String(url), "https://auth.example.com/token");
        assert.equal(init?.method, "POST");
        return new Response(JSON.stringify({ access_token: accessToken, refresh_token: refreshToken, token_type: "Bearer" }), { status: 200, headers: { "content-type": "application/json" } });
    };
}

const SERVER_URL = "https://svc.example.com/mcp";
/** 授权服务器 metadata fixture（RFC 8414 必填字段 + PKCE S256；预置进 discovery 后 SDK 不再发 discovery 请求）。 */
const AS_METADATA = { issuer: "https://auth.example.com", authorization_endpoint: "https://auth.example.com/authorize", token_endpoint: "https://auth.example.com/token", response_types_supported: ["code"], code_challenge_methods_supported: ["S256"], grant_types_supported: ["authorization_code", "refresh_token"] };
const RESOURCE_METADATA = { resource: SERVER_URL };
const CLIENT_INFORMATION = { client_id: "client-1" };
/** 预置 discovery state（RFC 9728 + 授权服务器 metadata 的缓存，spec §八：与 verifier 同等持久化）。 */
const DISCOVERY_STATE = { authorizationServerUrl: "https://auth.example.com", authorizationServerMetadata: AS_METADATA, resourceMetadata: RESOURCE_METADATA, resourceMetadataUrl: "https://svc.example.com/.well-known/oauth-protected-resource" };

describe("mcp-oauth-provider", () => {
    it("T-M22: token 存取往返——saveTokens 后同实例与新实例（restore）都读回，SDK 的 issuer 戳一并落库", async () => {
        const store = fakeSecretStore();
        const provider = await McpOAuthProvider.restore("svc", store);
        await provider.saveTokens({ access_token: "at-1", refresh_token: "rt-1", token_type: "Bearer", issuer: "https://auth.example.com" });
        assert.deepEqual(await provider.tokens(), { access_token: "at-1", refresh_token: "rt-1", token_type: "Bearer", issuer: "https://auth.example.com" });
        const again = await McpOAuthProvider.restore("svc", store);
        assert.equal((await again.tokens())?.access_token, "at-1");
        assert.equal((await again.tokens())?.issuer, "https://auth.example.com");
    });

    it("T-M22: redirectUrl 稳定——restore 时绑定并持久化，新建 provider 实例仍读回同一值", async () => {
        const store = fakeSecretStore();
        const provider = await McpOAuthProvider.restore("svc", store, "nm://oauth/callback");
        assert.equal(provider.redirectUrl, "nm://oauth/callback");
        assert.equal(persistedOf(store).redirectUrl, "nm://oauth/callback");
        const again = await McpOAuthProvider.restore("svc", store);
        assert.equal(again.redirectUrl, "nm://oauth/callback");
    });

    it("T-M22: 过期刷新——已有 refresh_token 时 auth() 走刷新分支，新 token 落回 SKSP", async () => {
        const store = fakeSecretStore();
        // redirectUrl 必须在（授权腿设置过）：SDK 只在交互式流程下走刷新分支，无 redirectUrl 视为非交互 grant。
        seed(store, { tokens: { access_token: "at-old", refresh_token: "rt-1" }, client: CLIENT_INFORMATION, discovery: DISCOVERY_STATE, redirectUrl: "nm://oauth/callback" });
        const provider = await McpOAuthProvider.restore("svc", store);
        // 模拟 transport 401 触发的静默刷新路径（不带 authorizationCode、不强制重授权）。
        const outcome = await auth(provider, { serverUrl: SERVER_URL, fetchFn: tokenFetch("at-new", "rt-2") });
        assert.equal(outcome, "AUTHORIZED");
        const again = await McpOAuthProvider.restore("svc", store);
        assert.equal((await again.tokens())?.access_token, "at-new");
        assert.equal((await again.tokens())?.refresh_token, "rt-2");
    });

    it("T-M22: codeVerifier 与 state 写入后新建 provider 实例仍能读回", async () => {
        const store = fakeSecretStore();
        const provider = await McpOAuthProvider.restore("svc", store);
        await provider.saveCodeVerifier("verifier-xyz");
        const state = await provider.state();
        const again = await McpOAuthProvider.restore("svc", store);
        assert.equal(await again.codeVerifier(), "verifier-xyz");
        assert.equal(unwrap(await again.verifyCallback({ code: "ac-1", state })), "ac-1");
        assert.equal(persistedOf(store).state, state);
    });

    it("T-M22: start → handleCallback 全链——authorizeUrl 带 PKCE/state/redirect_uri，交换后 tokens 落库、一次性状态清掉", async () => {
        const store = fakeSecretStore();
        seed(store, { client: CLIENT_INFORMATION, discovery: DISCOVERY_STATE });
        const factory = McpOAuthFactory.create({ listServers: () => [oauthConfig()], secretStore: store, fetchFn: tokenFetch("at-cb", "rt-cb") });
        const started = unwrap(await factory.start("svc", "https://127.0.0.1:8765/callback"));
        const authorizeUrl = new URL(started.authorizeUrl);
        assert.equal(authorizeUrl.origin + authorizeUrl.pathname, "https://auth.example.com/authorize");
        assert.equal(authorizeUrl.searchParams.get("response_type"), "code");
        assert.equal(authorizeUrl.searchParams.get("client_id"), "client-1");
        assert.equal(authorizeUrl.searchParams.get("redirect_uri"), "https://127.0.0.1:8765/callback");
        assert.ok(authorizeUrl.searchParams.get("code_challenge"));
        assert.equal(authorizeUrl.searchParams.get("code_challenge_method"), "S256");
        const state = authorizeUrl.searchParams.get("state");
        assert.ok(state);
        unwrap(await factory.handleCallback("svc", { code: "ac-9", state }));
        const persisted = persistedOf(store);
        assert.equal((persisted.tokens as Record<string, unknown>).access_token, "at-cb");
        assert.equal(persisted.codeVerifier, undefined);
        assert.equal(persisted.state, undefined);
    });

    it("T-M22: handleCallback 拒收——error 原样报、state 不匹配拒、code 缺失拒、无在途授权拒", async () => {
        const store = fakeSecretStore();
        const factory = McpOAuthFactory.create({ listServers: () => [oauthConfig()], secretStore: store, fetchFn: tokenFetch("at-x", "rt-x") });
        const noPending = unwrapErr(await factory.handleCallback("svc", { code: "c", state: "s" }));
        assert.match(noPending.message, /没有进行中的 OAuth 授权/);
        seed(store, { state: "pending-state", redirectUrl: "https://127.0.0.1:8765/callback" });
        const mismatched = unwrapErr(await factory.handleCallback("svc", { code: "c", state: "other-state" }));
        assert.match(mismatched.message, /state 与发起时不一致/);
        const rejected = unwrapErr(await factory.handleCallback("svc", { state: "pending-state", error: "access_denied" }));
        assert.match(rejected.message, /access_denied/);
        const noCode = unwrapErr(await factory.handleCallback("svc", { state: "pending-state" }));
        assert.match(noCode.message, /缺少授权 code/);
        // 拒收分支不动一次性状态：只清在途授权，残留 state 留给后续回调判定。
        assert.equal(persistedOf(store)["state"], "pending-state");
    });

    it("T-M22: start 的配置守卫——server 不存在 / 非 http 传输 / 非 oauth 鉴权都拒", async () => {
        const store = fakeSecretStore();
        const stdio: McpServerConfig = { id: "legacy", name: "legacy", enabled: true, transport: { type: "stdio" }, timeoutMs: 1000, auth: { type: "oauth" } };
        const noneAuth: McpServerConfig = { ...oauthConfig("plain"), auth: { type: "none" } };
        const factory = McpOAuthFactory.create({ listServers: () => [oauthConfig(), stdio, noneAuth], secretStore: store });
        const missing = unwrapErr(await factory.start("nope", "https://127.0.0.1:1/cb"));
        assert.match(missing.message, /未配置/);
        const notHttp = unwrapErr(await factory.start("legacy", "https://127.0.0.1:1/cb"));
        assert.match(notHttp.message, /Streamable HTTP/);
        const notOAuth = unwrapErr(await factory.start("plain", "https://127.0.0.1:1/cb"));
        assert.match(notOAuth.message, /OAuth 鉴权/);
        assert.equal(store.map.has(McpSecretRefs.oauth("nope")), false);
    });

    it("invalidateCredentials 按 scope 清字段，all 删整键（invalid_grant 自动重试的依赖面）", async () => {
        const store = fakeSecretStore();
        seed(store, { tokens: { access_token: "at-1" }, client: CLIENT_INFORMATION, codeVerifier: "v", state: "s", discovery: DISCOVERY_STATE, redirectUrl: "nm://oauth/callback" });
        const provider = await McpOAuthProvider.restore("svc", store);
        await provider.invalidateCredentials("tokens");
        assert.equal(await provider.tokens(), undefined);
        assert.equal((await provider.clientInformation())?.client_id, "client-1");
        await provider.invalidateCredentials("verifier");
        await assert.rejects(provider.codeVerifier(), /缺少 PKCE codeVerifier/);
        const revoked = await provider.verifyCallback({ code: "c", state: "s" });
        assert.ok(!revoked.ok);
        assert.match(revoked.ok ? "" : revoked.error.message, /没有进行中的 OAuth 授权/);
        await provider.invalidateCredentials("all");
        assert.equal(store.map.has(McpSecretRefs.oauth("svc")), false);
    });

    it("读路径容错：损坏 JSON 与未知形状字段按未知丢弃，回空状态不炸", async () => {
        const store = fakeSecretStore();
        store.map.set(McpSecretRefs.oauth("svc"), "{broken json");
        const provider = await McpOAuthProvider.restore("svc", store);
        assert.equal(await provider.tokens(), undefined);
        assert.equal(await provider.discoveryState(), undefined);
        assert.equal(provider.redirectUrl, undefined);
        store.map.set(McpSecretRefs.oauth("svc"), JSON.stringify({ tokens: "not-an-object", codeVerifier: 42, state: "keep-me" }));
        const again = await McpOAuthProvider.restore("svc", store);
        assert.equal(await again.tokens(), undefined);
        assert.equal(await again.verifyCallback({ code: "c", state: "keep-me" }).then((r) => r.ok), true);
    });
});
