/**
 * Mobile VFS character-card import via Core service + system file UI.
 * Flow: confirmed Alert (caller) → picker png/json → importFromBytes.
 */
import {AppError} from '@novel-master/core/errors';
import {VfsServiceFactory, CHARACTER_CARD_MAX_INPUT_BYTES, type CharacterCardImportOptions, type VfsScope} from '@novel-master/core/vfs';
import {DocumentIo, type PickAndReadOptions} from './document-io';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {CharacterCardDocumentPick} from './character-card-document-pick';

type CharacterCardImportRequest = Pick<CharacterCardImportOptions, 'confirmed'> & {
    readonly directoryPath?: string;
};

export const VfsCharacterCardService = {
    async import(runtime: MobileNovelMasterRuntime, scope: VfsScope, options: CharacterCardImportRequest): Promise<void> {
        const pickOptions: PickAndReadOptions = {
            mimeTypes: CharacterCardDocumentPick.importPickTypes(),
            fallbackLocalFileName: 'character-card.json',
            // assertFileName 槽位只认 throw：校验失败从 Result 原样解包成 throw 中止导入。
            assertFileName: name => {
                const check = CharacterCardDocumentPick.assertFileName(name);
                if (!check.ok) {
                    // nm-throw: keep — 校验槽位契约只认 throw（zod preprocess 同款例外）：Result 失败位原样解包中止导入
                    throw check.error;
                }
            },
            // 读取前 stat 预检：巨型卡片不进整读/解析链，避免原生 OOM；
            // 与 core 层 importFromBytes 的 bytes.length 闸门同阈值双保险。
            maxBytes: CHARACTER_CARD_MAX_INPUT_BYTES,
            buildTooLargeError: sizeBytes =>
                new AppError('VFS_CHARACTER_CARD_TOO_LARGE', {descriptor: {key: 'error.vfs.character_card_too_large.input' as const, params: {size_bytes: sizeBytes, limit_bytes: CHARACTER_CARD_MAX_INPUT_BYTES}}}),
            buildCopyError: copyError => new AppError('VFS_CHARACTER_CARD_UNRECOGNIZED', {detail: copyError ?? '无法读取所选角色卡文件'}),
            buildMissingError: fsPath => new AppError('VFS_CHARACTER_CARD_UNRECOGNIZED', {detail: `角色卡文件不存在：${fsPath}`}),
        };
        const bytes = await DocumentIo.pickAndReadBytes(pickOptions);
        if (bytes == null) {
            return;
        }

        const directoryPath = options.directoryPath == null || options.directoryPath.trim() === '' ? '/' : options.directoryPath;
        const svc = VfsServiceFactory.createCharacterCardImport(runtime.conn);
        await svc.importFromBytes(scope, bytes, {
            confirmed: options.confirmed,
            directoryPath,
        });
    },
} as const;
