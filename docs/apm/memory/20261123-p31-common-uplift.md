# p31 infra 通用包上收 common（2026-11-23）

用户发起：hash-content 该是通用工具？infra 有些包定位奇怪该放 common。盘点 14 个 infra 包后开 p31。

## 提交链
- 76d7ecf8a ContentHash → common/hash.ts 的 Hash.sha256Hex（FNV/SHA-256 同族互文）
- 8c0c89f6f 三包上收（tag p31-common-uplift）

## 盘点结论（infra 14 包定性表，后续轮次勿重查）
**错放上收**：serialization（zod wire 编解码，19 跨域消费）、prompt-template（Go-style macro，名字挂错内容无 prompt 概念）、events（同步事件总线）。
**合理留置**：平台设施 tdbc(89)/sql-template(50)/llm-protocol(56)/tokenizer(47)/sksp(21)/log(33)/nmtp/create-driver-registry；业务设施 cloud-sync/db-backup/db-maintenance；边界设计 content-cache（用户拍板的统一解压缓存层）。

## 判据（写进 SKILL.md 的是「通用工具签名不得含业务名词」的住址镜像版）
通用工具（只做原语变换、零平台资源、跨域消费）住业务目录 = 错放；有平台资源/跨端差异/业务决策背景的留 infra。

## 迁移细节与坑
- serialization 5 文件 git mv 保历史；TextFormat 双定义合并（stringify-text 从 parse-text re-export）；`@module` 标签同步改。
- macro：MacroScan+MacroRender 合并进 common/macro.ts（合并时两组 import 重复——python 按行号删）；WeekCn 单方法并入 DateTime.weekCn，keep-local 豁免（单点调用但内联会退回 domain）。
- events：LogFactory 依赖解法 = onHandlerError 默认 console.error、装配点注入回调覆盖；no-raw-console 守卫（test/infra/log/no-raw-console.test.ts）的 ALLOWED 集合要加 common/events.ts。
- **dist-artifacts.test 的 REQUIRED_DIST_FILES 清单跟着迁移改**（infra/events/simple-event-bus.js → common/events.js）——迁移轮的红测试首查这类「结构契约测试」。
- macro.ts 合并时 tsc 报 Duplicate identifier 的根因是两组 import 都保留，删行解决。

## 验收终态
core tsc 0、core 960/0、desktop 774/0、mobile 2384/2384、nm-style PASS、dist 完整重建。
