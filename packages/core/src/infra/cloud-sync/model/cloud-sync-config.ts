/**
 * 云同步保存配置的输入 DTO（desktop / mobile 共用单一类型）。
 *
 * `secretAccessKey` 在类型层可缺省：desktop 在已存 SK 时留空表示保留原密钥；
 * mobile 表单要求显式填写（非空校验在各端 store 内，不在类型层）。
 *
 * @module infra/cloud-sync/model/cloud-sync-config
 */

/** 保存云同步配置的输入（含明文 SK，仅写入时短暂存在内存）。 */
export interface CloudSyncConfigInput {
    endpoint: string;
    bucket: string;
    region: string;
    pathPrefix: string;
    accessKeyId: string;
    /** 留空表示保留已存密钥（由各端 store 的校验策略决定是否允许）。 */
    secretAccessKey?: string;
    forcePathStyle: boolean;
    deviceLabel?: string;
}
