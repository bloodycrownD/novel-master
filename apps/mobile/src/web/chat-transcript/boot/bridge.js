/**
 * RN 桥：postMessage、主题应用与宿主消息分发。
 */
  function post(type, payload) {
    var msg = JSON.stringify({ v: BRIDGE_V, type: type, payload: payload || {} });
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(msg);
    }
  }

  function applyTheme(theme) {
    if (!theme) return;
    var root = document.documentElement;
    root.style.setProperty('--bg', theme.background || '#fff');
    root.style.setProperty('--text', theme.text || '#111');
    root.style.setProperty('--text-secondary', theme.textSecondary || '#666');
    root.style.setProperty('--primary', theme.primary || '#007aff');
    root.style.setProperty('--danger', theme.danger || '#d92d20');
    root.style.setProperty('--surface', theme.surface || '#f2f2f7');
    root.style.setProperty('--border', theme.borderLight || '#e5e5ea');
  }

  function handleHostMessage(raw) {
    var msg;
    try {
      msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      return;
    }
    if (!msg || msg.v !== BRIDGE_V || !msg.type) return;
    var p = msg.payload || {};
    switch (msg.type) {
      case 'init':
        applyTheme(p.theme);
        if (p.flags) {
          state.flags = {
            richText: !!p.flags.richText,
            menuDisabled: !!p.flags.menuDisabled,
          };
        }
        break;
      case 'sessionSnapshot':
        applySnapshot(p);
        break;
      case 'prependPage':
        applyPrependPage(p);
        break;
      case 'appendTailRows':
        applyAppendTailRows(p);
        break;
      case 'streamDelta': {
        appendStreamDelta(p.kind, p.delta || '', p.html || '');
        break;
      }
      case 'streamBatch': {
        applyStreamBatch(p);
        break;
      }
      case 'streamReset':
        clearStreamRichUpgrade();
        state.stream = { text: '', thinking: '', textHtml: '', thinkingHtml: '', toolInvoking: false };
        renderRows();
        break;
      case 'streamCommit':
        clearStreamRichUpgrade();
        state.stream = { text: '', thinking: '', textHtml: '', thinkingHtml: '', toolInvoking: false };
        applyStreamCommit(p);
        break;
      case 'streamToolInvoking':
        setStreamToolInvokingDom(!!p.active);
        break;
      case 'flagsUpdate':
        if (p.flags) {
          var nextFlags = {
            richText: !!p.flags.richText,
            menuDisabled: !!p.flags.menuDisabled,
          };
          if (flagsEqual(state.flags, nextFlags)) {
            break;
          }
          var richToggledOn = !state.flags.richText && nextFlags.richText;
          state.flags = nextFlags;
          if (state.flags.menuDisabled) {
            closeContextMenu(true);
          }
          // Rich on: wait for sessionSnapshot rows with textHtml (avoid escapeHtml fallback).
          if (!richToggledOn) {
            renderRows();
          }
        }
        break;
      case 'themeUpdate':
        applyTheme(p.theme);
        break;
      case 'closeMenu':
        closeContextMenu(true);
        break;
      default:
        break;
    }
  }

  function onHostMessage(event) {
    var data = event && event.data;
    if (data == null) return;
    handleHostMessage(data);
  }
