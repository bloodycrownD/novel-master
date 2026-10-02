# 机位注册表（主代理派遣台账）

> **用途**：主代理上下文压缩后，按本表重建编队状态（谁在跑/谁完成/报告在哪）。
> **维护纪律**：每次派遣**登记在先**（状态 running），收割时更新（done + 信封摘要）。
> 完成的 agent 可用其 agentId 经 SendMessage 续话追问（如需核对报告细节）。
> **压缩后恢复流程**：读 PLAN.md（协议）→ status.md（裁决）→ 本表（编队状态）→ docs/apm/memory/20260930-mega-cr-feasibility.md（决策史）。

## W1 校准波（4/4 完成）

| zone | agentId | 状态 | 报告 |
|---|---|---|---|
| core-chat | agent_dce9daad-7516-4de0-94d3-ed0356d53e1f | done | raw/w1-core-chat.md（P2×9 P3×11） |
| core-tool | agent_87fc4aed-8a71-47b6-9fca-c4c8ee277de6 | done | raw/w1-core-tool.md（P2×4 P3×16） |
| mobile-chat-ui | agent_2a101f6e-641f-4936-ad3c-9de5a5fc2211 | done | raw/w1-mobile-chat-ui.md（P2×6 P3×19） |
| desktop-main | agent_50d35286-ec30-4637-86eb-443caf8e237f | done | raw/w1-desktop-main.md（P1×2 P2×9 P3×16） |

## W2 按域测绘（15/22 完成，7 running @ 2026-10-01 记录时点）

| zone | agentId | 状态 | 报告 |
|---|---|---|---|
| core-agent | agent_a6ba4ce6-43e6-4f82-a97c-d099a4ff875b | done | raw/w2-core-agent.md（P1×1 P2×10 P3×12） |
| core-vfs | agent_101e400b-402e-4e55-bd47-80a9dce1ffc2 | done | raw/w2-core-vfs.md（P1×3 P2×5 P3×16；renamePrefix 实测复现） |

**W2 终态：22/22 done（2026-10-01）。**

## W3 横切扫描（11 机位，2026-10-01 放量）

| zone | agentId | 状态 | 报告 |
|---|---|---|---|
| xc-fullread | agent_1d3571c2-442d-4c1d-afed-2237d93372d8 | done | raw/w3-xc-fullread.md（**P0×2** P1×4 P2×7 P3×3；主代理逐字封印两处） |
| xc-cache-lifecycle | agent_898b5514-1780-4d26-8a7d-1b8f9f99671d | done | raw/w3-xc-cache-lifecycle.md（P1×1；top 与 service-vfs P1-1 独立撞车=模板拉取漏清二次印证） |
| xc-cache-apps | agent_a0c1f858-d4db-40e3-b791-952054df4427 | done | raw/w3-xc-cache-apps.md（P1×2；top 与 mobile-runtime F-2 二次印证） |
| xc-dead-core | agent_4ac2843b-48f4-4bec-afbf-d6800bc51b4c | done | raw/w3-xc-dead-core.md（P1×2；**L0 大修正**：core"仅测试"桶 35.7% 实为 barrel 转发的生产消费；"确认死"617 中 173 条是快照锁定公开面、真可删 363 条） |
| xc-dead-apps | agent_26cf8dd2-18b6-439f-8340-a28e0a705b72 | done | raw/w3-xc-dead-apps.md（P1×2；apps+periph 真死 24 条 / 假阳 17 条，1048 行孤儿表单与 548 行地雷脚本领衔删除 backlog） |
| xc-ipc | agent_2fce01ab-ff28-4f49-8728-2acbc796b14c | done | raw/w3-xc-ipc.md（P2×9；12 断链逐条定性完毕；Typecheck 假债务实测全绿可转 blocking） |
| xc-dup-ends | agent_2539a8d5-a930-400e-b0d6-ec2bfc6b1b50 | done | raw/w3-xc-dup-ends.md（P1×1 P2×6 P3×4；**L0 修正：真环 7→5**；summarizeToolInput 三份三行为；修复包：BUILTIN_SKILL_NAMES 下沉 + post 抽共享） |
| xc-proto | agent_14c9edd6-23ff-4793-8076-b0ed71ecafcb | done | raw/w3-xc-proto.md（P1×2：流中断重试重复正文**实跑证实**——W2 双源撞车项转 confirmed；data: 无空格丢整流） |
| xc-txn | agent_fdaaec43-f64c-404a-b81e-419b397b06a5 | done | raw/w3-xc-txn.md（P1×2 P2×13 P3×5；copy 事务内全量解压 + ZIP 导入 5000 文件单事务） |
| xc-encoding | agent_5f9f47fa-f93c-47f1-a833-75005d9522f4 | done | raw/w3-xc-encoding.md（P2×13 P3×4；10/10 父版干净可精确回滚；防再犯闸需同时拦 U+FFFD 与 invalid-utf8 字节） |
| xc-sweep31 | agent_3d17da51-250f-4bd2-80b4-f99b364cbd84 | done | raw/w3-xc-sweep31.md（P1×1：fix-settings-utf8.mjs 未接线地雷，跑一次即毁 AgentEditorView 1381 行） |

## W4 对抗对（5 区 × 辩护/检察，2026-10-01 放量，成员互不知晓、禁读 raw/）

| zone | agentId | 状态 | 报告 |
|---|---|---|---|
| w4-runner-pro | agent_9ed287bb-5559-43f7-abaa-a25e25ea5d3b | done | raw/w4-runner-pro.md（P2×20 P3×10；onRunFailed.stage 恒 runner.run、前奏 7 stage 死写） |
| w4-runner-adv | agent_c230a924-037a-4150-a34d-7bd9626176e6 | done | raw/w4-runner-adv.md（P2×2 P3×4；六条让步项） |
| w4-msgstore-pro | agent_b581ea1d-ba48-4354-80e9-5eb5460371ff | done | raw/w4-msgstore-pro.md（P2×4 P3×7） |
| w4-msgstore-adv | agent_e810147b-603e-46aa-80c6-dcfec8e5e678 | done | raw/w4-msgstore-adv.md（P2×2 P3×18；让步清单：seq 发号竞态、usage-stats 分支复制） |
| w4-vfsstore-pro | agent_d47bb029-c442-4807-898f-02f4317fa76f | done | raw/w4-vfsstore-pro.md（P1×8；top 与 core-vfs P1 独立撞车=renamePrefix REPLACE 损坏路径二次印证） |
| w4-vfsstore-adv | agent_f570cbb0-15c1-4c98-b235-9ccae6a02970 | done | raw/w4-vfsstore-adv.md（P2×4；fork 漏 contentHash 判空撞 CHECK 致事务回滚） |
| w4-rollback-pro | agent_6ecf6f95-25a6-44a5-94a8-3676197f2f2b | done | raw/w4-rollback-pro.md（P1×4；undo_send 硬编码 hasDirectTargetTree 可删用户手建文件） |

**W3 终态：11/11 done。W4 终态：10/10 done（2026-10-01）。**

## W5 归并层（8 机位，2026-10-01 放量）

| zone | agentId | 状态 | 输入（raw/） | 输出 |
|---|---|---|---|---|
| synth-core-data | agent_ed2ad18a-a5db-4c0d-bd46-dc478f2cc9b0 | done | w1-core-chat、w2-core-checkpoint、w2-core-small、w2-core-service-chat、w4-msgstore-{pro,adv}、w4-rollback-{pro,adv} | synth/core-data.md（137→62 条，27 多源/17 对抗裁定/7 争议） |
| synth-core-runtime | agent_715d7eda-e4df-4b0f-84ff-1bf8de301be9 | done | w2-core-agent、w2-core-service-agent、w4-runner-{pro,adv}、w3-xc-fullread、w3-xc-cache-lifecycle | synth/core-runtime.md（60 条：P0×2 P1×6，8 争议） |
| synth-core-storage | agent_89b6f155-29ab-45aa-9723-65cfb0bc2a12 | done | w2-core-vfs、w4-vfsstore-{pro,adv}、w2-core-infra-sql、w2-core-bootstrap、w3-xc-txn | synth/core-storage.md（76 条：P1×11；renamePrefix 双源印证领衔） |
| synth-core-misc | agent_6e7abfea-8b4d-4f29-acff-e78405592b76 | done | w2-core-{provider,skills,workplace,prompt}、w2-core-infra-{proto,misc}、w3-xc-{proto,dup-ends} | synth/core-misc.md（134→39 条：P1×5；流中断三源印证+重复计费面；D-1/D-6 上交） |
| synth-apps-mobile | agent_aa937106-9a3b-468c-86c6-5be0408bacc6 | done | w1-mobile-chat-ui、w2-mobile-{runtime,ui,nav,web}、w3-xc-{cache-apps,encoding} | synth/apps-mobile.md（49 条：P1×3） |
| synth-apps-desktop | agent_fabc0f5b-d56c-43da-82e1-f5782cade04d | done | w1-desktop-main、w2-desktop-{features,core}、w3-xc-ipc | synth/apps-desktop.md（31 条：P1×4；IPC 断链三口径归一 11 条；X1+CI 合并三档整改） |
| synth-dead | agent_552da5e4-5eef-47d2-b076-9981a65b86c3 | done | w3-xc-{dead-core,dead-apps}、L0/dead-exports.md | synth/dead-backlog.md（42 作业三批次，实测总可删 ≈2886 行；L0 testOnly 桶污染 127 条标记勿用；8 条待裁决） |
| synth-cloudsync | agent_67e89aa2-d38c-4add-b662-d61267836e1c | done | 五源云同步节 | synth/cloudsync.md（35 条：P0×1 P1×7；pull 生命周期时间线重排；P0 主代理结构封印） |

**W5 终态：8/8 done（2026-10-01）。合计 ~352 条归并发现（P0×3 P1×~39），争议上交 ~53 条。**

## W6 验证波 + W7 架构拼装（2026-10-01 放量）

| zone | agentId | 状态 | 输入 | 输出 |
|---|---|---|---|---|
| verify-core-data | agent_cddf7554-c469-4837-a7ca-ad4fe4fb5070 | done | synth/core-data.md | synth/verify-core-data.md（CD-01 维持 P1，rewind 空树删工作区确认） |
| verify-core-runtime | agent_3d3b28e4-96e4-4123-843f-c6b8ea5843dc | done | synth/core-runtime.md | synth/verify-core-runtime.md（2 confirmed / 4 adjusted；RT-07 判 refuted） |
| verify-core-storage | agent_46cd40d3-0f6d-401c-9c39-77b8b6a3b3c0 | done | synth/core-storage.md | synth/verify-core-storage.md（9 confirmed / 1 adjusted，4 实测探针；CS-04 受害面扩 5 调用方、CS-10 机理改述） |
| verify-core-misc | agent_9475d08e-2e52-497b-b85d-acb21e8f7c1d | done | synth/core-misc.md | synth/verify-core-misc.md（2 confirmed / 1 adjusted / **1 refuted**：M-02 论据自反、M-05 实测证伪） |
| verify-apps-mobile | agent_09990ce0-1904-46e0-89d9-2c25b7ad7c69 | done | synth/apps-mobile.md | synth/verify-apps-mobile.md（3/3 confirmed） |
| verify-apps-desktop | agent_414a3705-8dc3-4fd8-afdd-054967c77dfc | done | （误路径→实际盲扫：A=S-D-04 双源、C=S-D-03 双源；新增 B mode-dirty / E 模型 pin 静默丢失 两条 P1、D 软锁降 P2；产物已从野目录归位） | synth/verify-apps-desktop.md |
| verify-dead | agent_3b1bfa9d-c425-435f-896c-fb8e903f235f | done | synth/dead-backlog.md（抽样复核） | synth/verify-dead.md（26 条：20 confirmed / 2 refuted / 4 adjusted；批次 1 可开工） |

**W6 终态：8/8 done。arch-assemble done。累计派遣 65 机位。**

## W7 终局台账（收官机位）

| zone | agentId | 状态 | 输入 | 输出 |
|---|---|---|---|---|
| ledger-assemble | agent_ef8b927f-f61d-4c83-89ee-5b4bf6bb737e | done | synth/*.md 全部 16 份 + status.md 裁决 | ledger.md（终局：P0×3 / P1×32 / P2×150 / P3×174；Wave A-E 修复波次；15 项用户拍板） |

## W10 delta 波（2026-10-01 main→v1.5.29 合并后放量，8 机位）

> 基线 9ca5f5ad→fe79b781（message-plaintext + read/skill 引用化 + 5 轮 CR 修复，118 文件 +10774/−3219）。
> mcr 已 fast-forward 合并。kkvstore-a（f6b4f937）在旧基线扫描中，其报告涉 db-maintenance 部分由 delta 重验覆盖。

| zone | agentId | 状态 | 输出 |
|---|---|---|---|
| d-revalidate-a（P0×3 + cloudsync/storage 簇 P1） | dd336b8e✓ | done（valid 20/partial 1：RT-01 建议降 P2、CS-11 前提作废） | synth/revalidate-a.md |
| d-revalidate-b（runtime/misc/apps 簇 P1） | 9cdcd43a✓ | done（valid 13/stale 1/partial 1：RT-01 仅 hidden 半被修、全量读仍在） | synth/revalidate-b.md |
| d-plain-pro / d-plain-adv（明文化链对抗对） | a85bc44a✓ / a4a820ef✓ | done（LIKE 粗筛 Unicode 漏召回双源） | raw/w10-d-plain-{pro,adv}.md |
| d-readref-pro / d-readref-adv（引用化链对抗对） | 644bbab4✓ / 78a9f44a✓ | done（双源：repair 未接线） | raw/w10-d-readref-{pro,adv}.md |
| d-survey（delta 总览→architecture v2 素材） | 4ef8ac94✓ | done | synth/delta-overview.md |
| kt-sksp（sksp-android Kotlin 深审，末位盲区） | c63b6cf4✓ | done（密钥基线合格；阻塞原生队列是复发项） | raw/w10-kt-sksp.md |

## W8 补强波（2026-10-01 用户追责后放量，25 机位补满承诺覆盖）

| 组 | zone | agentId | 状态 | 输出 |
|---|---|---|---|---|
| 对抗对×5 | w8-prompt | 3610d516✓ / 2f9f2855✓ | done | raw/w8-prompt-{pro,adv}.md |
| 对抗对×5 | w8-workplace | 1a8b0145✓ / d071c99b✓ | done | raw/w8-workplace-{pro,adv}.md |
| 对抗对×5 | w8-provider | 57080f54✓ / 59a81077✓ | done | raw/w8-provider-{pro,adv}.md |
| 对抗对×5 | w8-skills | 4bb0228e✓ / 7ff6efd7✓ | done | raw/w8-skills-{pro,adv}.md |
| 对抗对×5 | w8-mobileweb | 36dd6a35✓ / 7b06aa7a✓ | done | raw/w8-mobileweb-{pro,adv}.md |
| 双扫×4 | ds-chatservices | f435d26b✓ / d6a2f9d6✓ | done | raw/w8-ds-chatservices-{a,b}.md |
| 双扫×4 | ds-llmproto | 41e2efd6✓ / 673904af✓ | done | raw/w8-ds-llmproto-{a,b}.md |
| 双扫×4 | ds-webbridge | 010dd07d✓ / 0f714892✓ | done | raw/w8-ds-webbridge-{a,b}.md |
| 双扫×4 | ds-kkvstore | f6b4f937✓ / d2d5d892✓ | done（跨合并扫描，db-maintenance 部分由 W10 重验覆盖；top 与 core-small F-6 独立印证） | raw/w8-ds-kkvstore-{a,b}.md |
| Kotlin×2 | kt-sse / kt-infra | d5170604✓ / 5a20bd9b✓ | done | raw/w8-kt-{sse,infra}.md |
| 测试语料×4 | test-core-a/b、test-mobile、test-desk-cli | cd0d4659✓ / 3c40f117✓ / de9d287f✓ / 82f98cbc✓ | done | raw/w8-test-*.md |
| 覆盖热图×1 | cov-hotmap | f7ebcd62✓ | done | L0/coverage-hotmap.md（89.94% 覆盖，T1 全死 4 文件/T2 60 文件 7674 行/T3 91 符号 10304 行；cli 子进程覆盖不回流为下限） |

## W9 全量正反覆盖波（2026-10-01 用户二次追责后放量，32 机位：12 对抗对 + 4 组双扫）

> 用户要求：每个区域都要多视角正反应证，允许重复派遣。W1/W2 单扫区域全部补对抗对；
> 四个最重区域另加双扫（与既有 W1/W2 报告构成三方可比）。

| zone（对抗对各 pro+adv） | agentId | 状态 | 输出 |
|---|---|---|---|
| w9-chat | d7053e75✓ / abc3f329✓ | done | raw/w9-chat-{pro,adv}.md |
| w9-tool | 9542d445✓ / e31fa6de✓ | done | raw/w9-tool-{pro,adv}.md |
| w9-checkpoint | 5d17cbfb✓ / b8ba9adc✓ | done | raw/w9-checkpoint-{pro,adv}.md |
| w9-agentmisc | dde525c2✓ / 38006a8b✓ | done | raw/w9-agentmisc-{pro,adv}.md |
| w9-infrasql | f5a113c2✓ / 7ec87e4a✓ | done | raw/w9-infrasql-{pro,adv}.md |
| w9-inframisc | 579b9b02✓ / 1cbec669✓ | done | raw/w9-inframisc-{pro,adv}.md |
| w9-servicevfs | 568fd3d8✓ / 22743126✓ | done | raw/w9-servicevfs-{pro,adv}.md |
| w9-bootstrap | 69d46aeb✓ / f05b43cd✓ | done | raw/w9-bootstrap-{pro,adv}.md |
| w9-mobileui | a6b2946c✓ / 2c5c2c11✓ | done | raw/w9-mobileui-{pro,adv}.md |
| w9-mobilenav | df60a992✓ / 77b39592✓ | done | raw/w9-mobilenav-{pro,adv}.md |
| w9-desktopfeat | cf1d87d2✓ / ae480016✓ | done | raw/w9-desktopfeat-{pro,adv}.md |
| w9-cliperiph | f73cdd0a✓ / 1522c242✓ | done | raw/w9-cliperiph-{pro,adv}.md |
| ds2-chat | e386354b✓ / 6d3c6737✓ | done | raw/w9-ds2-chat-{a,b}.md |
| ds2-tool | 5665260a✓ / e995b177✓ | done | raw/w9-ds2-tool-{a,b}.md |
| ds2-servicevfs | 0e220966✓ / 62b01de8✓ | done | raw/w9-ds2-servicevfs-{a,b}.md |
| ds2-desktopfeat | 9eb3691d✓ / c46c3912✓ | done | raw/w9-ds2-desktopfeat-{a,b}.md |

**【管线终局 2026-10-01】全波次完成。累计派遣 66 机位（W1×4 + L0b×1 + W2×22 + W3×11 + W4×10 + W5×8 + W6×8 + W7×2），零纪律事故、零 git 写、零源码改动。交付物：architecture.md + ledger.md + synth/16 份 + raw/47 份 + L0/ 六件套 + status.md + registry.md。**
| verify-cloudsync | agent_eef6f335-3189-463f-8ae3-b2af24747a66 | done | synth/cloudsync.md | synth/verify-cloudsync.md（4 confirmed / 3 adjusted：S-CS-02 影响面扩大、S-CS-03 桌面被 syncBusy 部分化解） |
| arch-assemble | agent_db05d461-eb10-4e18-b1a9-9f53870f850a | done | synth/*.md 架构小结 + L0/inventory.md | architecture.md（五节：分层图/模块导航/五数据流/不变量/债务热点） |
| w4-rollback-adv | agent_6fee8d29-ccaf-4a72-8100-0c6b66433679 | done | raw/w4-rollback-adv.md（P2×8 P3×6；辩护人侧也交出 IN 未分块+release 非事务） |
| w4-cloudsync-pro | agent_d616ebda-e0cb-4613-aa45-3bca7b6dd602 | done | raw/w4-cloudsync-pro.md（P1×6 P2×9 P3×8；top 与 mobile-runtime F-3 独立撞车=交叉印证） |
| w4-cloudsync-adv | agent_a62f9ddf-86ff-412b-a48d-9bdbca9aee03 | done | raw/w4-cloudsync-adv.md（**P0×1**：pull 后 rev 写入已关连接必抛 CONNECTION_CLOSED，实测确认） |
| core-provider | agent_842b4bc2-0c1f-49d3-9e84-16cd4357abc9 | done | raw/w2-core-provider.md（P1×1 P2×6 P3×16） |
| core-checkpoint | agent_68b6a082-ac1a-4eb7-a2ae-c0037a9eb978 | done | raw/w2-core-checkpoint.md（P2×3 P3×12） |
| core-skills | agent_3e8b0eee-bf56-4d1f-abf0-02ff08da0a51 | done | raw/w2-core-skills.md（P2×5 P3×11） |
| core-workplace | agent_d5ebf94a-e9e8-4160-a2af-f65a16585842 | done | raw/w2-core-workplace.md（P1×2 P2×5 P3×13） |
| core-prompt | agent_9845afe2-97ba-4468-a899-4f78a0c3184c | done | raw/w2-core-prompt.md（P1×1降P2 P2×4 P3×7） |
| core-small | agent_2155ccb4-2782-4f8f-ad0e-3575d515a292 | done | raw/w2-core-small.md（P2×3 P3×14） |
| core-infra-sql | agent_337a6191-026b-4610-a072-e6a84358ccbc | done | raw/w2-core-infra-sql.md（P1×3 P2×4 P3×9；探针已自清，shim 疑云解除） |
| core-infra-proto | agent_e7b6796e-7a86-4ffb-9804-957ffddf5991 | done | raw/w2-core-infra-proto.md（P1×1 P2×7 P3×15） |
| core-infra-misc | agent_74e817c0-b378-4c3a-872c-6e0fad1abdee | done | raw/w2-core-infra-misc.md（P1×1 P2×5 P3×10） |
| core-service-chat | agent_904d1886-0e61-435f-8361-5562ffc1e65c | done | raw/w2-core-service-chat.md（P1×1潜伏 P2×9 P3×10；三全量读确认+能力缺口定性） |
| core-service-agent | agent_4db2ad91-15f2-4268-a5ea-670a11615d58 | done | raw/w2-core-service-agent.md（P2×3 P3×10；反发现：852/1201 非热路径） |
| core-service-vfs | agent_269f388d-9f4e-42c3-8a58-c480fdb588d9 | done | raw/w2-core-service-vfs.md（P1×2 P2×6 P3×9） |
| core-bootstrap | agent_a9326858-cb8f-4922-b509-4d9c910c1ee0 | done | raw/w2-core-bootstrap.md（P2×4 P3×12） |
| mobile-runtime | agent_353df3c7-240f-4a5f-9a36-d36d23573363 | done | raw/w2-mobile-runtime.md（P1×3 P2×4 P3×11） |
| mobile-ui | agent_46117911-72ed-4538-b041-564053275e1a | done | raw/w2-mobile-ui.md（P1×1 P2×11 P3×13） |
| mobile-nav | agent_271d8f88-c486-4f07-8e9c-3224ac759287 | done | raw/w2-mobile-nav.md（P2×11 P3×17） |
| mobile-web | agent_c1cc3e81-604b-4012-a8b3-d99a6e27766f | done | raw/w2-mobile-web.md（P2×5 P3×10） |
| desktop-features | agent_b34e3474-2e5d-4b69-9834-82f6dd2a0e43 | done | raw/w2-desktop-features.md（P1×3 P2×7 P3×20） |
| desktop-core | agent_b985c83e-da8f-403c-aac3-70adc272e309 | done | raw/w2-desktop-core.md（P1×3 P2×9 P3×6） |
| cli-periph | agent_74064a63-ef85-4595-9775-c44a7c7d3377 | done | raw/w2-cli-periph.md（P1×2 P2×17 P3×14） |

## L0b 确定性普查（W3 前置件）

| zone | agentId | 状态 | 报告 |
|---|---|---|---|
| deterministic-sweeps | agent_677f4cfe-a5e5-425a-aeb5-8ca43e284a73 | done | L0/ 四件套：dead-exports 1317 确认+26 suspect+580 仅测试；circular 13 环（剔 type 边余 7，runtime-risk 0）；IPC 断链 12；未覆盖 88（其中 57=core-vfs 在途机位，非真盲区） |

## 后台任务

| 任务 | task-id | 状态 |
|---|---|---|
| mcr npm install | exec_a5fe1e20-7a2d-43b9-9c0e-932b5e74904e | done（2258 包 42s） |
| madge 循环扫描（结论已撤回，别名假阴性） | exec_cc6c0288-c45a-4949-8638-bf65ab750999 | done |

## 环境要点（压缩后必读）

- 仓库：`D:\Dev\nm-worktree\mcr`，分支 `feat/repo-mega-cr`（基 main@9ca5f5ad），依赖已装。
- L0 产物在 `L0/`（inventory / coverage-matrix / sql / ipc / kkv / todo 六份 + 脚本 tmp/l0-census.mjs）。
- 主仓未提交修正（docs/apm/RULE.md 两处 + 记忆文件）**待用户提交**；worktree 内 RULE 是旧提交版（压缩副作用条目为旧文，已知）。
- worktree 根 `M package-lock.json` 为 npm install 正常漂移；`packages/core/src/infra/serialization/index-probe-shim.ts` 为疑似探针残留（见上表注）。

## W11 终局拼装（2026-10-01 放量，1 机位）

| zone | agentId | 状态 | 输出 |
|---|---|---|---|
| final-assemble | e3f54508✓ | done（ledger-v2 + architecture v2 + 一致率附录；RT-01 主代理裁 P1 落账） | ledger-v2.md + architecture.md v2 + 一致率表 |

**【全管线终局 2026-10-01】132 机位全部完成（L0b+W1~W11），零在飞。基线 fe79b781（v1.5.29）。终局台账：P0×5 / P1×40 / P2×155 / P3×174 + 待验证单源 10 条 + 已消化附录 3 条。**

## S 阶段 · fix-spec 化与 spec-check-loop（2026-10-01 启动，用户指令：高并发分片）

> 协议见 PLAN.md 第四章；总纲 fix-spec/SPEC.md；编排状态 fix-spec/state.md。
> 编制（向用户报过，必须跑满不得缩水）：W-S1 撰写 10 机位 → 每轮审查 = 分片 reviewer + 1 全局 judge，轮次上限 5。

### W-S1 撰写波（2026-10-01 放量，异步后台 10 机位）

| zone | agentId | 状态 | 输出 |
|---|---|---|---|
| s-wave-a | agent_da7ae4b7-7876-4113-bfe4-e2d4fad5c30b | done（7 条目；行号全实测核对、纠正 6 处台账/wave-e 偏差——偏差细节待 reviewer 核对后回填；15.5M token 最重片） | fix-spec/wave-a.md |
| s-cloudsync | agent_e8001512-bd46-468e-b860-740dd174bce7 | done（6 条目+§6#1 注记；755 行；台账行号漂移已由机位亲自核对修正；**doc-fix 已做 G1-G4/M1/M2/M5 六组，余 M4/M6半/M7/M8/M9/M10+MF-C* 待续**） | fix-spec/wave-b-cloudsync.md |
| s-core-b1 | agent_c04ee1e4-f7ed-4520-848f-144b59e222a3 | done（8 条目；新发现：CS-04 GC 步恒 0 行、泄漏面比台账广——待 reviewer 复核） | fix-spec/wave-b-core1.md |
| s-core-b2 | agent_5d9cbbf3-978c-463b-b02e-14995cb6d5ac | done（10 条目；CS-07 归一至本片与 c2 的 C2-5 谱系待 sr1-core2-c 裁定；自报 M-04 量级 M 与「全部 S」批次声明冲突待核） | fix-spec/wave-b-core2.md |
| s-apps-b | agent_566ee330-957c-42c7-a5f9-da0a1c9be731 | done（4 条目+2 注记节；§6#5 白屏第三源复核成立入账 P1；自报 renderer 基线可量化降至 423 待核） | fix-spec/wave-b-apps.md |
| s-wave-c1 | agent_b2155c14-4ee5-488d-b03e-4deb8e745328 | running | fix-spec/wave-c1.md |
| s-wave-c2 | agent_a6808246-a359-4b04-ba41-8c9788b69485 | done（9 条目七要素全展开；**sr1-c2-a 审查 No-Go：spec-defect 5/验收不可测 4/修法打架 4/code-drift 1，must-fix 待主代理 doc-fix**） | fix-spec/wave-c2.md |
| s-wave-d | agent_51b43b90-3cc9-4d40-8b3b-ed5fec2065ca | done（28 条：16+9 逐条+批次3规程+8 死通道+3 blocked；10 处口径修正回写含 ANCHORED_MENU_TOUCH_ANCHOR_HEIGHT 非直接死码） | fix-spec/wave-d.md |
| s-wave-e | agent_51314dc5-cdde-4fe1-9a7b-1a995f94ed9c | done（12 条目；撰写机位自改台账修法：WebView 门禁「出现即 fail」4/4 包先天命中第三方库，改三门设计——待 reviewer 实测核对） | fix-spec/wave-e.md |
| s-baseline | agent_6b956f22-a2b7-4753-8f1d-ba127ab66fae | done（21 命令实跑；**renderer=411 定案（424 已漂移，三源撞车）**；core 3126/3fail；desktop 带参 628/1flake；mobile 1739/1fail；**根 build TS5042 根因复现：npm 10.9.4 --workspaces 参数转发，兜底=逐包 build + desktop 补 build:preload**；desktop 默认 npm test 收集 0 条（N-P0-02 实锤）） | fix-spec/baseline.md |

### SR1 流水审查波（v2 编排：分片完成即放该片 reviewer，条目组粒度）

| zone | agentId | 状态 | 报告 |
|---|---|---|---|
| sr1-cloudsync-a（S-CS-07/16+§6#1） | agent_2044316f-c01e-437e-b091-8dc2b893a10b | done（**No-Go**：valid 18/spec-defect 5/验收不可测 3/code-drift 2/修法打架 1；M1-M10 清单） | raw/sr1-cloudsync-a.md |
| sr1-cloudsync-b（S-CS-01 P0 深审） | agent_496c8188-7f88-4495-9fe9-ab2a05d4e2b7 | done（G1-G4 已由主代理 doc-fix 闭合） | raw/sr1-cloudsync-b.md |
| sr1-cloudsync-c（S-CS-02/D5/03+债务池51.9%） | agent_443f8098-dae2-49e7-9d64-14b4a1c1cd4c | done（Go with MF-C1~C7；转 judge：S-CS-04/08/09 漏认领→已派补写机位；S-CS-13=push侧/S-CS-03=pull侧写死；S-CS-18+19 合并、S-CS-14 改口径） | raw/sr1-cloudsync-c.md |
| zone | agentId | 状态 | 报告 |
|---|---|---|---|
| sr1-cloudsync-a（S-CS-07/16+§6#1） | agent_2044316f-c01e-437e-b091-8dc2b893a10b | done（**No-Go**：M1-M10） | raw/sr1-cloudsync-a.md |
| sr1-cloudsync-b（S-CS-01 P0 深审） | agent_496c8188-7f88-4495-9fe9-ab2a05d4e2b7 | done（G1-G4） | raw/sr1-cloudsync-b.md |
| sr1-cloudsync-c（S-CS-02/D5/03+债务池51.9%） | agent_443f8098-dae2-49e7-9d64-14b4a1c1cd4c | done（Go + MF-C1~C7） | raw/sr1-cloudsync-c.md |
| sr1-c2-a（C2-1/2/6 事务backfill族） | agent_3f996fb6-cc37-43a7-922f-804727cdf4ed | done（No-Go：7 must-fix+6 建议——已派 dfx-c2a） | raw/sr1-c2-a.md |
| sr1-c2-b（C2-3/4/5 revision写路径族） | agent_9ee73061-3dce-4a30-8ef4-f37edb6fc27a | done（10.2M token 大审：P0×2（均 CS-07 存量库迁移）P1×4 P2×6 P3×2；**主代理裁定：维持 core2 默认案②、migration 作备选注记、旧名不存在的验收硬约束照落——已派 dfx-c2b-core2**；对 C2-3/C2-4/N-1 的 findings 待 dfx-c2-cs07 完成后一并派） | raw/sr1-c2-b.md |
| sr1-c2-c（C2-7/8/9+债务池） | agent_4bb59b04-66e7-4405-b9b6-5edae7fb5b60 | done（Go-conditional；must-fix 三组已由主代理闭合：fflate 静默截断撤第3步/try 外抛点/32766 改述） | raw/sr1-c2-c.md |
| sr1-core1-a（CS-01/N-P1-01/CS-04） | agent_a24fecc5-3297-44dd-8e55-91312c31755e | done（CS-04 恒 0 行主张成立；must-fix 12 **待处理**） | raw/sr1-core1-a.md |
| sr1-core1-b（RT-04/RT-08/RT-01） | agent_8e087040-17f2-4db0-aa3d-95ca462b66b7 | done（must-fix×5 已由 dfx-core1b 落实：**RT-01 弃 memo 改按 stepCompactionEmitted 复用 visible**（与 RT-02 同法更稳）；1 项待 judge 注记——**core1 片三组全闭合**） | raw/sr1-core1-b.md |
| dfx-core1b（core1 组B must-fix 5） | agent_d3327ba9-8468-43b7-99b2-4642aed35a7d | done（5 修+1 待 judge） | fix-spec/wave-b-core1.md |
| sr1-core1-c（§6#3/#4 三源复核+债务池） | agent_7955bd92-8dc1-42bf-ac9d-a9d38c404a29 | done（**B1-7 P1 被推翻——主代理已裁降 P2**；must-fix 1~9 已派 dfx-core1c 落实；债务池 有效6/重写1/核销1） | raw/sr1-core1-c.md |
| sr1-e-a（X1/renderer门禁/paths） | agent_385a2925-d28d-4db2-8abe-72f25ab19a87 | done（No-Go：must-fix 13；MF-1/2/11/13 主代理闭合 + MF-3~12 dfx-e 闭合 + 411 定案两处主代理补） | raw/sr1-e-a.md |
| sr1-e-b（WebView三门/编码①③） | agent_9a7d0c6e-d74f-4f51-9148-afeaaf5936d9 | done（43.8M 超大审：OK 12/OK* 5/MF 15 已派 dfx-eb；三门方向对但门B取不到值、门C牙反向、H1 算错 178、H3 无牙） | raw/sr1-e-b.md |
| dfx-eb（wave-e 组B MF 15——judge 前最后一个 doc-fix） | agent_c838b34c-d603-4d67-abb5-ec2b026deaab | done（15 项、2 待 judge：门B取值改相对键、门C牙齿改4、H1口径改178、H3用例改半角——**全部 doc-fix 闭合**） | fix-spec/wave-e.md |
| judge-r1（R1 全局收口） | agent_cbaa9e8b-82be-4c9b-aa64-cadd607effa5 | done（**R1 = No-Go，R2 must-fix 18 条**；judge 实跑推翻 baseline §1.1 TS5042 根因〔cmd `;` 串联测量假象〕；7 条 P1 无落位；依赖图缺 3 边；B-3 不立登记 P2；F 节回写真源在 synth；31.2M token） | fix-spec/judge-r1.md |

### R2 修复波（2026-10-01 放量，按 judge-r1 H.3 清单分六路、文件互不重叠）

| zone | agentId | 状态 | 范围 |
|---|---|---|---|
| r2-base | agent_903fcf47-1cf8-4223-b7fa-3abd2e9012d9 | done（6 处：TS5042 归因订正为 cmd shell 包装、逐包 build 指令撤回、SPEC 补 3 边+分配表+§4+§1 计数） | baseline.md + SPEC.md |
| r2-apps | agent_e3c47480-9445-464e-80a2-02fc4f78e222 | done（4 处：AM-3/S-D-04/E 三条七要素补写 + B-3 裁决落文档 + 分母刷新） | wave-b-apps.md |
| r2-c2 | agent_b4d20749-2011-4ee9-8ac6-d4ef57c92576 | done（3 处：CD-01/CS-03 七要素补齐、CD-13 正名、c1 注记改移交） | wave-c2.md + wave-c1.md |
| r2-core2 | agent_c9341df4-f789-4aaf-ac72-040ea0c3154e | done（3 处：M-01 七要素补写 + 两处引用改——**R2 六路全部完成**） | wave-b-core2.md |

**【R2 完成 2026-10-01】六路（base/apps/c2/core2/d/hygiene）全部回报：R2-1~R2-18 全落（judge H.3 十八条 + 附带项）。下一步：R3 judge 复核（按 H.3 判据逐条验收，不重放 reviewer）。**

| judge-r3（R3 复核收口） | agent_9a495a65-4f28-4292-beec-048e2d9449dc | done（**R3 = Go**：18 条 17✓+1 半；judge 抽验 15 处行号逐字在位；c2 分片反修 judge 转录漂移；execute-ready 前提满足；R4 十处卫生收尾） | fix-spec/judge-r3.md |
| dfx-r4（R4 卫生收尾 10 处） | agent_1e78d88e-6da4-41c5-ac07-cef88a040b68 | done（10 处全落 8 文件——**R4 清零，S 阶段全部收尾完成**） | 8 文件单行级 |

**【S 阶段终局 2026-10-01】R3 judge = Go，execute-ready 待用户确认。总派遣：撰写 11 + 补写 2（x1/R2 六路中 4）+ baseline 1 + 审查 28 + dfx 22 + judge 3 ≈ 71 机位。**

### DEV 波（code-dev-loop，2026-10-01 用户确认 execute-ready 开工；同步派遣模式——用户指定）

**【dev-loop 终局 2026-10-01】Wave A→E 全部 func-ready，dev-ready 达成。19 个提交（5d6b9661..046f4d9c）落在 feat/repo-mega-cr（基 fe79b781）。终态：core 3291/3、desktop 660/660、mobile 1744/1、cli 105/24、tsc 0/0/371/0、编码 0/0/0、lint desktop/core/drivers 0 error。未施工：批次3/MESSAGES_*/sksp 三处（★1/★3/★4/★5 拍板未答；★1 前置 L0 重分桶已完成）。wave_plan/node_status 全记录在 fix-spec/state.md。**

| zone | agentId | 状态 | 说明 |
|---|---|---|---|
| dev-A（wave-0~2） | 7 impl + 2 verify + 1 cr-func（同步） | done func-ready | 7 commits |
| dev-B（wave-0~4） | 5 impl + gap/b2 fix + 2 verify + cr-func×2 | done func-ready | 4 commits（M1 BOM 主代理直改） |
| dev-C（wave-0~4） | c2→c1 串行 + verify + fix-C-tests + cr-func×2 | done func-ready | 3 commits |
| dev-D（wave-0~1） | 3 impl + verify-cr-func 合并 | done func-ready | 2 commits |
| dev-E（wave-0~2） | 3 impl + fix-E + cr-func-E2 | done func-ready | 4 commits（ci.yml 引号主代理直改） |
| r2-d | agent_91cde1c1-8ff4-4f41-9f78-5c228731299c | done（4 处：F-synth-dead-1 补写 + D-207 三处按 C③ 回写方案①） | wave-d.md |
| r2-hygiene | agent_1899a716-faa9-4812-b543-ce8c7a515faa | done（10 处：R2-7e侧/11/12/13/14/15/17 全落——含 synth 真源回写五项） | wave-e/core1/raw×1/synth×2 |

**【R1 收口前置完成 2026-10-01】28/28 reviewer 报告磁盘对账在盘（raw/sr1-*.md × 28）；撰写 11/11；baseline 落盘；全部 must-fix 已闭合或由 dfx-eb 收尾中。dfx-eb 回报后立即放全局 judge 收口 R1。**
| sr1-e-c（钩子②④⑤⑥+注释承诺+债务池） | agent_e4e27760-3ca5-4b50-bdde-1c929fe82be9 | done（OK 2 / must-fix 6 已派 dfx-ec；H6↔N-P0-02 同处归一看报告建议；债务池 5/5 过） | raw/sr1-e-c.md |
| s-cloudsync-x1（补写 S-CS-04/08/09） | agent_47b7ec98-edbb-4b8f-8ade-1a0dcf7734f3 | done（3 条七要素+并入说明；SPEC.md 已补认领行） | fix-spec/wave-b-cloudsync-x1.md |
| sr1-cloudsync-x1（S-CS-04/08/09+并入说明） | agent_28a0a5e8-998e-4bb5-9f83-bf6b4f27e09e | done（not-ready×4：修法样例编译不过、验收恒绿——已派 dfx-x1） | raw/sr1-cloudsync-x1.md |
| sr1-apps-a（N-P1-04/§6#5） | agent_465f6ed3-9b9d-48f7-ac23-3f553041bb47 | done（conditional-go×2；must-fix 6 已派 dfx-apps2；N3「renderer root 整树崩溃」采纳） | raw/sr1-apps-a.md |
| sr1-apps-b（AM-1/N-P1-03） | agent_70e44400-2e4c-4b6c-91b2-19f7b54a5ad3 | done（not-ready×2；must-fix 9 已派 dfx-apps2；**B-3 主代理裁①**） | raw/sr1-apps-b.md |
| sr1-apps-c（#6/#7 注记+423 主张+债务池） | agent_dbcffe58-5eb9-4792-814b-3a6ea61615c2 | done（must-fix 3 已由 dfx-apps 闭合；**411 三源撞车**；债务池 10/46 全过） | raw/sr1-apps-c.md |
| sr1-core2-a（N-P1-02/M-06/summarize） | agent_c0a64e3f-db11-4209-bf00-4ad4e64a08b4 | done（must-fix 11 已由 dfx-core2a 落实（2 待 judge）——core2 片四组全闭合） | raw/sr1-core2-a.md |
| dfx-core2a（core2 组A must-fix 11） | agent_bb387f92-e307-404c-bb8e-db2bb00adfbc | done（11/11、2 待 judge） | fix-spec/wave-b-core2.md |
| sr1-core2-b（M-03/M-04/CS-02/B/S-D-02 打包批） | agent_fcbf3245-352a-4981-8bb7-1d133c47a4eb | done（READY 2/NOT-READY 4；must-fix 已派 dfx-core2b；M-04 实测量级 M 须独立 commit、S-D-02 夹具必红） | raw/sr1-core2-b.md |
| sr1-core2-c（CS-07 谱系+CS-08+债务池） | agent_4dfd4f7e-0d59-433f-8056-082650865557 | done（**CS-07 谱系裁定：同一条、core2 §7 权威、c2 注记化——主代理采纳**；must-fix 11 已派 dfx-core2c） | raw/sr1-core2-c.md |
| sr1-d-a（批次1 D-101~116） | agent_57638a90-102d-47fd-beea-e0022eafb2e4 | done（PASS 12/COND 3/FAIL 0；must-fix 4 已派 dfx-da；D-101 删除理由不成立） | raw/sr1-d-a.md |
| sr1-d-b（批次2/3+规程） | agent_df1cdf58-b93f-496c-b4c7-d49cc08378e8 | done（Go 6/Go-with-fix 2/No-Go 1；must-fix 18 已派 dfx-db；top D-207 撞 RULE:74 坑） | raw/sr1-d-b.md |
| sr1-d-c（死通道+三组新目标+债务池） | agent_f2ee148d-9c1f-4fbe-bfe7-8645f7399a1d | done（must-fix 11 已由 dfx-dc 全落、0 待 judge——**wave-d 片三组全闭合**） | raw/sr1-d-c.md |
| dfx-dc（wave-d 组C must-fix 11） | agent_7a815d22-b5ea-425c-8738-53a848cf5766 | done | fix-spec/wave-d.md |
| dfx-cloudsync（M3~10+MF-C*） | agent_30866529-8905-4b31-a7a1-836bfa335858 | done（12 项全落、陈旧串自查归零） | fix-spec/wave-b-cloudsync.md |
| dfx-apps（apps-c MF-1/2/3） | agent_561c3210-65bc-4239-950d-e870988ddd61 | done（411 基线口径落入 apps 片） | fix-spec/wave-b-apps.md |
| dfx-e（wave-e MF-3~12） | agent_508eb9f1-1509-4133-bc55-fb2c6edcda9b | done（9 项全修） | fix-spec/wave-e.md |
| dfx-core1c（core1-c MF-1~9） | agent_6a8de1a5-96ba-4d14-95f6-98189a23a69c | done（9 项全落；B1-7 降 P2 + 探针） | fix-spec/wave-b-core1.md |
| dfx-c2a（c2-a 七项+六建议） | agent_ad87347b-756f-4ad7-8325-bf7359268ae6 | done（13 项全落：releaseAndDeleteVfsPrefix/TOCTOU 案②/abort-signal 统一 5+1） | fix-spec/wave-c2.md |
| dfx-core2c（core2 11 项+谱系 core2 侧） | agent_0e0ba158-842d-438c-a0f3-bc99267df1a5 | done（9 项：CS-07 谱系上收、UPDATE 触发器并入、存量库路线收敛写死默认案②、验收命令笔误修、过度预警删） | fix-spec/wave-b-core2.md |
| dfx-core1a（core1-a M-1~12） | agent_6bbfbf56-02c1-419b-b2e1-f73fb5167c12 | done（12 项全落；P-D4/S-O3 恒真断言已重写） | fix-spec/wave-b-core1.md |
| dfx-db（wave-d 18 项） | agent_1491cb70-8fc8-4488-802e-876b28fc0428 | done（18 项全落，M-1 含 1 处待 judge 标注） | fix-spec/wave-d.md |
| dfx-c2-cs07（CS-07 归一 c2 侧注记化） | agent_ade7f695-7e71-4a51-a34e-15908f224e59 | done（C2-5 注记化、N-2 解除、交叉引用改指 core2 §7——**谱系归一双侧完成**） | fix-spec/wave-c2.md |
| dfx-c2b-c2（c2-b 剩余 findings：C2-3/C2-4/N-1/3.6） | agent_9c66967c-d171-44e8-9380-1192c13138d7 | done（9 处、0 待 judge：C3 断言改口径、C2-4 名校验二选一、N-1 改述） | fix-spec/wave-c2.md |
| dfx-core2b（core2 组B must-fix） | agent_344ac74e-01bd-41ad-804b-7eb801cff81c | done（12 处、0 待 judge：M-04 拆 C3b 独立 commit、S-D-02 夹具必红前置） | fix-spec/wave-b-core2.md |
| sr1-c1-a（全量读收窄系列） | agent_9cb73fb8-cf9e-469c-ae98-175fa7ae2316 | done（must-fix 17 已由 dfx-c1a 落实（2 待 judge）；**c1 片三组审查 must-fix 全闭合**） | raw/sr1-c1-a.md |
| dfx-c1a（c1 组A must-fix 17） | agent_ed4e2999-5b32-49ad-9cef-2c73bcd07df9 | done（17 项、2 待 judge：C1-3 补接口+3 mock、C1-2 I5 改结构断言） | fix-spec/wave-c1.md |
| sr1-c1-b（smart-sort+协议三条） | agent_9cec1040-adbe-413a-a395-74577d77f552 | done（条件Go×5；must-fix 18 已由 dfx-c1b 落实（2 处待 judge）） | raw/sr1-c1-b.md |
| dfx-c1b（c1 组B must-fix 18） | agent_b804eee2-99ed-4263-af8b-5c6b47ea0c77 | done（18 项、2 待 judge：C1-7 I4 换连接身份断言、C1-9 补必红、C1-10 解签名不对称） | fix-spec/wave-c1.md |
| sr1-c1-c（§6#11/#12+债务池） | agent_2f15958b-f469-4250-a8b2-d59d8931e7b0 | done（must-fix×7 should-fix×7 已派 dfx-c1c；C1-11 userAborted 必泄漏、C1-12 验收无牙；债务池 14 条） | raw/sr1-c1-c.md |
| dfx-c1c（c1 组C must-fix） | agent_76d0f67b-a683-4943-b20a-0b1a9b8741ea | done（14 处、0 待 judge：C1-11 泄漏改函数开头消费、C1-12 I1 换并发形状断言） | fix-spec/wave-c1.md |
| dfx-c2b-core2（c2-b 两个 P0 并入 core2 §7） | agent_f230aea6-4163-48c5-ac04-6e4f7f96793c | done（4 处：存量库硬约束+旧名不存在断言+DROP 旧名要求+migration 备选注记+回滚改述） | fix-spec/wave-b-core2.md |
| dfx-ec（wave-e 组C must-fix 6） | agent_9b96ffac-6017-48ca-ae68-c610e9ccdc8a | done（9 处：T-DS2d 期望改写、H6↔N-P0-02 归一、2 处待 judge 注记） | fix-spec/wave-e.md |
| dfx-ab（wave-a 组B must-fix 6） | agent_d2714d3a-ccf2-4cbd-9307-c5778bf2d639 | done（6 项全落：RT-02 验收装真触发器、门B白名单空数组） | fix-spec/wave-a.md |
| dfx-da（wave-d 组A must-fix） | agent_5201dc51-0387-4a7b-b9b2-d1a59864a227 | done（6 处：D-101 理由改「破坏先于报错」、M-4 复核达标、待 judge 0） | fix-spec/wave-d.md |
| dfx-ac（wave-a 组C must-fix） | agent_14f029d7-f396-4d63-86d9-293ef9757b7b | done（12 处、0 待 judge：A4 三验收重写、A7 改走 good-rev 还原——**wave-a 片三组全闭合**） | fix-spec/wave-a.md |
| sr1-a-a（N-P0-02/CI/A-14） | agent_75a4e0b4-5ce4-4c6b-9726-d55dabb33fb9 | done（PASS-with-MF×3 FAIL×0；must-fix 已由 dfx-aa 全闭合（A6 验收①拆分、A5 单行 node -e、A3 标已知红）） | raw/sr1-a-a.md |
| dfx-aa（wave-a 组A must-fix 7） | agent_2cf32981-ee0e-4c96-9ba0-313a1f70f967 | done（7 项、0 待 judge） | fix-spec/wave-a.md |
| sr1-a-b（RT-02/N-P0-01） | agent_967d8737-e165-40fe-a0cb-6bc9ac3a7bda | done（2 NEEDS-FIX / must-fix 6 已派 dfx-ab；RT-02 计数验收恒绿 + 与 X3 坐标矛盾） | raw/sr1-a-b.md |
| sr1-a-c（N-P0-03/编码批次1+债务池） | agent_87dfadc1-6436-45e5-87b0-29ff0e5f1873 | done（✅31⚠️11❌11；must-fix 已派 dfx-ac；A4 三验收跑不出结果、A7 漏用 good-rev 毁码风险） | raw/sr1-a-c.md |
| dfx-apps2（apps-a 6 + apps-b 9 含 B-3①裁决） | agent_769e6046-412b-460e-bea5-daff9abababe | done（16 项：B-1/B-2/B-3 高危修法洞全闭、基线锚点幂等补齐——**apps 片三组审查 must-fix 全闭合**） | fix-spec/wave-b-apps.md |
| dfx-x1（cloudsync-x1 not-ready 修正） | agent_0eaba21f-1fa7-4d4b-b625-df942552bf50 | done（18 项已修、待 judge 0：修法样例可编译、验收补牙） | fix-spec/wave-b-cloudsync-x1.md |

**cloudsync 片 R1 状态：三组审查 must-fix 全部闭合（主代理 8 处 + dfx 12 项），待 judge 复核。**

**待 judge 轮统一处理**：①root build TS5042 是否立新条目（npm 10.9.4 --workspaces 参数转发 bug，兜底=逐包 build+补 build:preload，见 baseline.md §1.1）；②债务池行号统一刷新（CD-03/09/20/34 见 SPEC.md §6 附注）；③S-CS-13=push侧/S-CS-03=pull侧 写回 ledger；④S-CS-18+19 合并、S-CS-14 改口径；⑤CS-07 双片谱系（core2 归一版 vs c2 的 C2-5，sr1-core2-c 裁定中）；⑥B-3 的 listByParentSession 另立条目与否；⑦wave-e X4 与 D-207 顺序（已互写依赖）。

**SR1 阶段小结（2026-10-01 更新②）**：**撰写 11/11 全部交货**（c1 最后一片 12 条目）；baseline 已出（411 定案、TS5042 根因、三包已知红）；审查已回 17/26（在飞 c2-b✓/core1-b/e-b/core2-a/core2-b/d-a/d-c/a×3/c1×3 = 9 个）；doc-fix 已闭合：cloudsync 片（全）、cloudsync-x1（全）、apps 片（全）、core1 的 a+c 组、e 片（a 组全+c 组已派 dfx-ec）、c2 的 a+c 组；CS-07 谱系归一完成（core2 权威+双 P0 并入中）。



## CR loop R1 派遣登记（code-review-loop, review_round 1 / dag_version 1）

对照 19 dev commits（5d6b9661..046f4d9c）全量 CR，11 路 review-scope。spec 真源：各 fix-spec 分片；产出物 cr-fix-spec.md。

| 机位 | 被审对象 | 状态 | 落盘 |
|---|---|---|---|
| cr-wavea | Wave A 7 commits | done | raw/cr1-wavea.md（0/1/6；run-tests ENOBUFS 诊断不可达） |
| cr-cloudsync | dc621d9a | done | raw/cr1-cloudsync.md（P1：桌面换代失败路径删唯一旧库副本） |
| cr-core1 | 6ffeb5fb | done | raw/cr1-core1.md（P1×3：T-P3 不稳定/RT-01 零测试/M-03 归属失配） |
| cr-core2 | 4829b8d1 | done | raw/cr1-core2.md（P1×2：M-04 软指针前提不成立致 currentModelId 悬空+commit 打包违背六 commit 拆分） |
| cr-apps | 37df8900 | done | raw/cr1-apps.md（P1×1：unresolved 态改选模型下拉与提示双说谎） |
| cr-c2 | c667be0f（C2 域） | done | raw/cr1-c2.md（P1×2：ZIP remainingBudget 双计误杀 30MiB 合法包+触发器 v2 守卫无索引全表扫） |
| cr-c1 | c667be0f（C1 域） | retry-1 in-flight | raw/cr1-c1.md（首派网络败，2026-10-02 重放） |
| cr-c-tests | 759372c8 | retry-1 in-flight | raw/cr1-ctests.md（同上） |
| cr-kotlin | d68a848b | retry-1 in-flight | raw/cr1-kotlin.md（同上） |
| cr-dead | 496b6fd8+6594b67c | retry-1 in-flight | raw/cr1-dead.md（同上） |
| cr-guards | 3b4c8d9e+5fb269fe+046f4d9c | retry-1 in-flight | raw/cr1-guards.md（同上） |

首波网络三败三重试全成（wavea/core2/apps）；c1 二次败；第三波 5 路（c1 重试/ctests/kotlin/dead/guards）provider 限流全败，2026-10-02 凌晨重放。


**CR R1 终态 2026-10-02**：5 路重试全成（kotlin 0/2/3 / ctests 0/2/4 / c1 0/0/8 / dead 0/0/6 / guards 0/5/4）——11/11 齐。首波 4 份报告写浅到 worktree 根 raw/，磁盘对账抓回归位。must-fix 合计报告侧 0/20/55（去重后 CR-F 位 0/19/54）。cr-fix-spec.md 落盘（round1/dag1）→ review-full（cr1-full.md）判 not-ready（漏收13/失真5/不可执行2）→ 主代理 20/20 闭合（OQ15-20/K9-K13/CR-F06-F20 编排归位/OQ2 改判注明）→ **fix-spec-ready**（待用户确认 OQ1-20 与 CR-W1..W5）。

**e2e 终态 2026-10-02**：nm35+Metro dev 链路全通——冷启 23.6MB bundle/会话/composer 打字（N-P0-01 直证）/发送/provider 配置（mock-llm 8799）/模型选择/assistant 流式回复上屏。停止按钮列 manual_user。产物截图 C:UsersBLOODY~1AppDataLocalTemp\e2e-{13..35}.png。


**CR 执行波次登记（code-dev-loop, 2026-10-02, spec=cr-fix-spec R4 Go）**
| 波 | 内容 | commits | cr-func |
|---|---|---|---|
| W1 | F01-F11+F20 六路并行（desktop/mobile/三端/core-src/core-test/kotlin） | 59b48913..ad131a5a（9 个） | func-ready（12 条矩阵全过；D 路重放事故复核无损坏；交办 F07 用例名+基线数→W5） |
| W2 | F12-F16 门禁工程（超时重编排→续收机位；F16 前机位病态回溯真缺陷修正） | a4647349..6a7239fa（4 个；F13 基线 371→190 同 commit 重写） | func-ready（D1 主代理裁新语义+spec 订正；D2 tdbc-conformance 撤收编→K14） |
| W3 | F17 甲案+F18/F19/L1-2/L1-3 文档四订正（主代理直改） | 45af8af5 | 并入 W4 合并检查 |
| W4 | L1 批三路并行+L1-1 乙案三红坐实→按 spec 预案升甲补 gc | 8c026e67..4de6cd3c（4 个） | func-ready（W3W4 合并；十处 deviation 全认可；两注释级漏项→W5） |
| W5 | 文档/CHANGELOG 批（主代理）+两路代码扫尾 | （进行中） | — |

**W5 终态**：A 路 12 项+B 路 10 项+主代理文档批——3 commits（fd531e55/d0750916/97a93b85）。cr-func-W5 func-ready（B-1 continue-on-error 认可/P2-7 真修认可/硬数字软化）。**dev-ready 达成：CR 执行 21 commits（59b48913..97a93b85），五波全 func-ready。**

**CR 后 e2e 终态（2026-10-02）**：新 APK（Kotlin 层含 F09/F10）+新 bundle 八项全过——schema 18->19 升级库无损/发送/流式/provider 改址/停止按钮（3s 慢 mock 窗口内打断）/停止后健康。截图 C:UsersBLOODY~1AppDataLocalTemp\cr-e2e-*.png / ck*.png / st*.png。
