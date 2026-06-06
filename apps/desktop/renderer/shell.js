/**
 * Desktop main shell — in-pane selection only (prototype).
 *
 * Invariants:
 * - Each data-group column/pane manages its own .is-active state.
 * - No cross-pane sync (explorer clicks do not update preview or chat).
 * - No @novel-master/core runtime, localStorage, or IPC business logic.
 */
(function initDesktopShell() {
  "use strict";

  /**
   * Bind click handlers so only one [data-selectable] item is active per container.
   * @param {ParentNode} root
   * @param {string} groupSelector - CSS selector for group containers
   */
  function bindSelection(root, groupSelector) {
    root.querySelectorAll(groupSelector).forEach(function bindGroup(container) {
      container.addEventListener("click", function onGroupClick(event) {
        var item = event.target.closest("[data-selectable]");
        if (!item || !container.contains(item)) {
          return;
        }

        container.querySelectorAll(".is-active").forEach(function clearActive(node) {
          node.classList.remove("is-active");
        });
        item.classList.add("is-active");
      });
    });
  }

  /**
   * Mark the first selectable item in each group as active by default.
   * @param {ParentNode} root
   * @param {string} groupSelector
   */
  function initDefaultSelection(root, groupSelector) {
    root.querySelectorAll(groupSelector).forEach(function initGroup(container) {
      var first = container.querySelector("[data-selectable]");
      if (first) {
        first.classList.add("is-active");
      }
    });
  }

  var app = document.getElementById("app");
  if (!app) {
    return;
  }

  initDefaultSelection(app, "[data-group]");
  bindSelection(app, "[data-group]");
})();
