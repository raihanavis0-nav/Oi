(function () {
  "use strict";

  var STORAGE_KEY = "thoughts_admin_collapsed_v1";
  var queued = false;

  function loadState() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch (_) {
      return new Set();
    }
  }

  function saveState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(state)));
    } catch (_) {}
  }

  var collapsed = loadState();

  function setCollapsed(section, button, key, value) {
    section.classList.toggle("is-collapsed", value);
    button.setAttribute("aria-expanded", value ? "false" : "true");
    button.title = value ? "Expand" : "Collapse";

    var icon = button.querySelector(".admin-collapse-icon");
    var nextIcon = value ? "▸" : "▾";
    if (icon && icon.textContent !== nextIcon) icon.textContent = nextIcon;

    if (value) collapsed.add(key);
    else collapsed.delete(key);
  }

  function makeButton(section, key, label) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "admin-collapse-toggle";
    button.innerHTML = '<span class="admin-collapse-icon" aria-hidden="true"></span>';

    setCollapsed(section, button, key, collapsed.has(key));
    button.setAttribute(
      "aria-label",
      (section.classList.contains("is-collapsed") ? "Expand " : "Collapse ") + label
    );

    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();

      var next = !section.classList.contains("is-collapsed");
      setCollapsed(section, button, key, next);
      button.setAttribute(
        "aria-label",
        (next ? "Expand " : "Collapse ") + label
      );
      saveState(collapsed);
    });

    return button;
  }

  function decorateSeries() {
    var host = document.getElementById("adminSeriesList");
    if (!host) return;

    Array.from(host.querySelectorAll(":scope > .admin-series-block")).forEach(
      function (block) {
        if (block.dataset.collapseReady === "series") return;

        var id = block.getAttribute("data-sort-id");
        var row = block.querySelector(":scope > .series-title-row");
        var title = row && row.querySelector(":scope > .series-title");
        if (!id || !row || !title) return;

        var label = title.textContent.trim() || "Series";
        row.insertBefore(makeButton(block, "series:" + id, label), title);
        block.dataset.collapseReady = "series";
      }
    );
  }

  function decorateSubseries() {
    var host = document.getElementById("adminSeriesList");
    if (!host) return;

    Array.from(host.querySelectorAll(".subseries-block")).forEach(function (block) {
      if (block.dataset.collapseReady === "subseries") return;

      var id = block.getAttribute("data-sort-id");
      var row = block.querySelector(":scope > .admin-subseries-title-row");
      var title = row && row.querySelector(":scope > .subseries-title");
      if (!id || !row || !title) return;

      var label = title.textContent.trim() || "Sub-series";
      row.insertBefore(makeButton(block, "subseries:" + id, label), title);
      block.dataset.collapseReady = "subseries";
    });
  }

  function currentData() {
    var sync = window.ThoughtsContentSync;
    if (!sync) return null;
    if (typeof sync.getUiData === "function") return sync.getUiData();

    if (typeof sync.getSnapshot === "function") {
      var snapshot = sync.getSnapshot();
      return snapshot && snapshot.data ? snapshot.data : null;
    }

    return null;
  }

  function characterGroupKey(group) {
    var firstCard = group.querySelector(".admin-character-card[data-character-id]");
    var characterId = firstCard && firstCard.getAttribute("data-character-id");
    var data = currentData();

    if (characterId && data && Array.isArray(data.characters)) {
      var character = data.characters.find(function (item) {
        return item && item.id === characterId;
      });

      if (character) {
        return "characters:" + String(character.seriesId || "global");
      }
    }

    return (
      "characters:name:" +
      String(group.getAttribute("data-character-series") || "global")
    );
  }

  function decorateCharacterGroups() {
    var grid = document.getElementById("adminCharacterGrid");
    if (!grid) return;

    Array.from(grid.querySelectorAll(":scope > .character-series-group")).forEach(
      function (group) {
        if (group.dataset.collapseReady === "characters") return;

        var heading = group.querySelector(":scope > .character-series-heading");
        if (!heading) return;

        var label = heading.textContent.trim() || "Characters";
        var button = makeButton(group, characterGroupKey(group), label);
        heading.insertBefore(button, heading.firstChild);
        group.dataset.collapseReady = "characters";
      }
    );
  }

  function decorate() {
    queued = false;
    decorateSeries();
    decorateSubseries();
    decorateCharacterGroups();
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      requestAnimationFrame(decorate);
    });
  }

  function loadStyles() {
    if (document.querySelector('link[href="css/thoughts-collapse.css"]')) return;

    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "css/thoughts-collapse.css";
    document.head.appendChild(link);
  }

  function init() {
    if (!document.getElementById("adminApp")) return;
    loadStyles();

    var library = document.getElementById("libraryView");
    if (library) {
      new MutationObserver(schedule).observe(library, {
        childList: true,
        subtree: true,
      });
    }

    schedule();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
