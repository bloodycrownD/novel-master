// @ts-nocheck
/**
 * chat-transcript boot 共享状态与版本常量。
 */
export var SCHEMA_V = 2;
export var BRIDGE_V = 1;
export var VFS_FILE_TOOLS = { read: 1, write: 1, edit: 1 };
export var state = {
    ready: false,
    nearBottom: true,
    sessionKey: '',
    rows: [],
    hasMore: false,
    stream: { text: '', thinking: '', textHtml: '', thinkingHtml: '', toolInvoking: false },
    flags: { richText: false, menuDisabled: false },
    menu: null,
    menuOverlayHandler: null,
    menuNativeTextBlockHandler: null,
    thinkingExpanded: {},
    toolGroupExpanded: {},
    attachGroupExpanded: {},
    scrollRaf: null,
    loadOlderArmed: true,
    longPressTimer: null,
    longPressTarget: null,
    menuOpenedAt: 0,
  };
