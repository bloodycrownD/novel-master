import assert from "node:assert/strict";
import {  describe, it  } from "node:test";

import {  CurlImport, type CurlCommandDraft, type  CurlParseError  } from "../../src/domain/tool/builtin/search/curl-import.js";
import type { Result } from "../../src/errors/either.js";

const SECRET = "sk-abcdefghijklmnopqrstuvwxyz012345";

/** 断言 Result.ok 并返回草稿（失败用例给可读诊断）。 */
function expectOk(result: Result<CurlCommandDraft, CurlParseError>): CurlCommandDraft {
    if (!result.ok) assert.fail(`解析应成功，实际失败：${JSON.stringify(result.error)}`);
    return result.value;
}

/** 断言 Result.err 并返回失败载荷（成功用例给可读诊断）。 */
function expectErr(result: Result<CurlCommandDraft, CurlParseError>): CurlParseError {
    if (result.ok) assert.fail(`解析应失败，实际成功：${JSON.stringify(result.value)}`);
    return result.error;
}

describe("curl 导入：合法命令解析预填 + 密钥识别替换（T-C6）", () => {
    it("POST -H Authorization Bearer -d JSON：method/url/headers/body 预填，密钥替换为 {{apiKey}} 并随草稿携带", () => {
        const text = `curl -X POST 'https://api.example.com/v1/search' -H 'Authorization: Bearer ${SECRET}' -H 'Content-Type: application/json' -d '{"query":"{{query}}","count":"{{count}}"}'`;
        const draft = expectOk(CurlImport.parseCommand(text));

        assert.equal(draft.method, "POST");
        assert.equal(draft.url, "https://api.example.com/v1/search");
        assert.equal(draft.headers.Authorization, "Bearer {{apiKey}}");
        assert.equal(draft.headers["Content-Type"], "application/json");
        assert.equal(draft.defaultBody, '{"query":"{{query}}","count":"{{count}}"}');
        assert.equal(draft.apiKey, SECRET, "明文密钥随草稿携带，保存时落 SKSP");
    });

    it("-G 把 -d 合并进查询串并归 GET；无 -G 的 -d 缺省 POST；无 body 缺省 GET", () => {
        const getForm = expectOk(CurlImport.parseCommand("curl -G -d 'q=hello&lang=zh' https://search.example.com/search"));
        assert.equal(getForm.method, "GET");
        assert.equal(getForm.url, "https://search.example.com/search?q=hello&lang=zh");
        assert.equal("defaultBody" in getForm, false);

        const defaultPost = expectOk(CurlImport.parseCommand("curl https://api.example.com/search -d '{\"a\":1}'"));
        assert.equal(defaultPost.method, "POST");
        assert.equal(defaultPost.defaultBody, '{"a":1}');

        const defaultGet = expectOk(CurlImport.parseCommand("curl https://example.com/search?q=x"));
        assert.equal(defaultGet.method, "GET");
        assert.equal(defaultGet.url, "https://example.com/search?q=x");
    });

    it("多个 -d 以 & 拼接；curl.exe 可执行名可识别", () => {
        const multiple = expectOk(CurlImport.parseCommand("curl -X POST https://api.example.com/search -d 'a=1' -d 'b=2'"));
        assert.equal(multiple.defaultBody, "a=1&b=2");

        const windowsExe = expectOk(CurlImport.parseCommand("curl.exe -X GET https://example.com/search"));
        assert.equal(windowsExe.method, "GET");
    });

    it("URL 内的疑似密钥同样识别并替换；占位符自身与短 token 不误判", () => {
        const urlSecret = expectOk(CurlImport.parseCommand(`curl 'https://api.example.com/search?api_key=${SECRET}'`));
        assert.equal(urlSecret.url, "https://api.example.com/search?api_key={{apiKey}}");
        assert.equal(urlSecret.apiKey, SECRET);

        const placeholder = expectOk(CurlImport.parseCommand("curl -X POST https://api.example.com/search -H 'X-API-KEY: {{apiKey}}' -d '{}'"));
        assert.equal(placeholder.headers["X-API-KEY"], "{{apiKey}}");
        assert.equal("apiKey" in placeholder, false, "占位符不是明文密钥，不携带 draft key");
    });

    it("非法输入整体拒绝：Result.err + error.tool.search_curl_parse_failed + 原因", () => {
        const cases: readonly { readonly text: string; readonly reason: RegExp }[] = [
            { text: "", reason: /empty command/ },
            { text: "wget https://example.com", reason: /command must start with curl/ },
            { text: "curl 'https://example.com", reason: /unterminated single quote/ },
            { text: "curl -H 'bad header' https://example.com", reason: /invalid header/ },
            { text: "curl --compressed https://example.com", reason: /unsupported option: --compressed/ },
            { text: "curl -X PATCH -d '{}' https://example.com", reason: /unsupported method: PATCH/ },
            { text: "curl -G -X POST -d 'q=1' https://example.com", reason: /-G conflicts with a non-GET -X method/ },
            { text: "curl", reason: /missing request URL/ },
        ];
        for (const { text, reason } of cases) {
            const error = expectErr(CurlImport.parseCommand(text));
            assert.equal(error.message.key, "error.tool.search_curl_parse_failed", `输入：${text}`);
            assert.match(String(error.message.params?.reason), reason, `输入：${text}`);
        }
    });

    it("多个不同明文密钥 → 整体拒绝（提示逐个导入）", () => {
        const text = "curl -H 'Authorization: Bearer sk-aaaaaaaaaaaaaaaaaaaaaaaa' -H 'X-API-KEY: sk-bbbbbbbbbbbbbbbbbbbbbbbb' https://api.example.com/search";
        const error = expectErr(CurlImport.parseCommand(text));
        assert.match(String(error.message.params?.reason), /multiple distinct plaintext secrets/);
    });
});

describe("共享密钥检测：正例/反例样例（SPEC §5）", () => {
    it("正例：sk- 前缀、Bearer 后 ≥20 字符、鉴权头赋值形态", () => {
        assert.deepEqual(CurlImport.findPlaintextSecrets("sk-abc123"), ["sk-abc123"]);
        assert.deepEqual(CurlImport.findPlaintextSecrets("Bearer abcdefghijklmnopqrst"), ["abcdefghijklmnopqrst"]);
        assert.deepEqual(CurlImport.findPlaintextSecrets("X-API-KEY: abcdefghijklmnopqrst"), ["abcdefghijklmnopqrst"]);
        assert.deepEqual(CurlImport.findPlaintextSecrets("X-Subscription-Token: abcdefghijklmnopqrst"), ["abcdefghijklmnopqrst"]);
    });

    it("反例：{{apiKey}} 占位符自身与短 token 不命中；重复命中去重", () => {
        assert.deepEqual(CurlImport.findPlaintextSecrets("Bearer {{apiKey}}"), []);
        assert.deepEqual(CurlImport.findPlaintextSecrets("X-API-KEY: {{apiKey}}"), []);
        assert.deepEqual(CurlImport.findPlaintextSecrets("Bearer short"), []);
        assert.deepEqual(CurlImport.findPlaintextSecrets("sk-abc123 sk-abc123"), ["sk-abc123"]);
    });
});
