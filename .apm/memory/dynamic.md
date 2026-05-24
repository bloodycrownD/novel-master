---
createdAt: '2026-05-25 00:45:47'
updatedAt: '2026-05-25 00:46:30'
---
2026-05-25: sksp-provider-model 已合并 main（feature/sksp-provider-model → main，HEAD 9a4e596）。含 SKSP（`core/infra/sksp` + `sksp-windows`/`sksp-android` 驱动）、provider/model CLI、OpenAI/Anthropic/Gemini 协议；协议与 env 后端导出 `@novel-master/core/sksp`。CLI 捕获见 kb `Iterations/provider-model/test/provider-cli.md`、`sksp/test/sksp-cli.md`。Android `SkspDevScreen` 待真机验收（`sksp/test/sksp-android.md` A2）。

下一步：新迭代前 `apm read`。远程 https://github.com/bloodycrownD/novel-master.git 分支 `master`（本地 `main`）。跑 CLI 测试前勿残留 `NOVEL_MASTER_DB`。
