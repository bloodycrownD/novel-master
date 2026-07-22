---
createdAt: '2026-05-23 17:38:51'
updatedAt: '2026-07-22 23:05:00'
---
assistant-bubble-flatten:
  type: feature
  iteration: mobile-chat-composer-annotate-ux
  status: cancelled_rolled_back
  rolled_back_to: c3c7e3df
  note: 气泡 UI 改另开迭代；本分支仅保留 mobile-chat-composer-annotate-ux 批注相关交付
remove-assistant-message-annotate:
  type: feature
  iteration: mobile-chat-composer-annotate-ux
  status: superseded
  superseded_by: remove-message-annotate
  note: 已被 remove-message-annotate 取代（User+Assistant 消息批注全部移除）
remove-message-annotate:
  type: feature
  iteration: mobile-chat-composer-annotate-ux
  status: done
  note: 消息批注全移除；文件批注保留；transcript 划词仅复制；Core isMessageAnnotatePath 历史防御保留
