/**
 * Helpers for message edit and action menu items.
 */
import { ChatMessage } from '@shared/logic/chat';
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
    items.push({ label: '编辑', action: 'edit' });
  }
  items.push({ label: '复制', action: 'copy' });
  if (isSetFloorEligibleMessage(message)) {
    items.push({ label: '置位', action: 'set-floor' });
  }
  items.push({ label: '分叉', action: 'fork' });
  if (!message.hidden) {
    items.push({ label: '回滚', action: 'rollback', danger: true });
  }
  return items;
}
