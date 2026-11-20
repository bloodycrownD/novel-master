/**
 * Helpers for message edit and action menu items.
 */
import { ChatMessage } from '@shared/logic/chat';
import { coreT } from '@shared/logic/core-i18n';
import type { ChatMessageDto } from '@shared/ipc-types';
import { chatMessageFromDto } from './composer-send-state';

interface MessageActionMenuItem {
  readonly label: string;
  readonly action: string;
  readonly danger?: boolean;
}

/** Re-export Core 规则；DTO 经 {@link chatMessageFromDto} 适配。 */
export function editableTextFromMessage( message: ChatMessageDto ): string | null {
  return ChatMessage.from(chatMessageFromDto(message)).editableText();
}

export function isSetFloorEligibleMessage(message: ChatMessageDto): boolean {
  return message.role === 'user';
}

/** 长按菜单：编辑、复制、置位、分叉、回滚（无 hide/unhide/delete）。 */
export function buildMessageActionItems( message: ChatMessageDto ): MessageActionMenuItem[] {
  const items: MessageActionMenuItem[] = [];
  if (editableTextFromMessage(message) != null) {
    items.push({ label: coreT({key: "ui.transcript.menu.edit"}), action: 'edit' });
  }
  items.push({ label: coreT({key: "ui.transcript.menu.copy"}), action: 'copy' });
  if (isSetFloorEligibleMessage(message)) {
    items.push({ label: coreT({key: "ui.transcript.menu.set_floor"}), action: 'set-floor' });
  }
  items.push({ label: coreT({key: "ui.transcript.menu.fork"}), action: 'fork' });
  if (!message.hidden) {
    items.push({ label: coreT({key: "ui.transcript.menu.rollback"}), action: 'rollback', danger: true });
  }
  return items;
}
