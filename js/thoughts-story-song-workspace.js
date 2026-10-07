(function () {
  "use strict";

  var currentRow = null;
  var resolveTimer = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function toast(message, error) {
    var node = $("adminToast");
    if (!node) return;

    node.textContent = message;
    node.style.color = error ? "var(--admin-danger)" : "";
    node.hidden = false;

    window.setTimeout(function () {
      node.hidden = true;
    }, 3000);
  }

  function selectedText(select) {
    if (!select || !select.value) return "";
    var option = select.options[select.selectedIndex];
    return option ? option.textContent.trim() : "";
  }

  function matchesCurrentStory(row) {
    var titleInput = $("storyTitleInput");
    var seriesInput = $("storySeriesInput");
    var subseriesInput = $("storySubseriesInput");
    var open = row.querySelector(".story-open");

    if (!titleInput || !open) return false;
    if (open.textContent.trim() !== titleInput.value.trim()) return false;

    var seriesName = selectedText(seriesInput);
    var seriesBlock = row.closest(".admin-series-block");
    var seriesTitle = seriesBlock && seriesBlock.querySelector(":scope > .series-title-row .series-title");

    if (
      seriesName &&
      seriesTitle &&
      seriesTitle.textContent.trim() !== seriesName
    ) {
      return false;
    }

    if (subseriesInput && subseriesInput.value) {
      var subseriesName = selectedText(subseriesInput);
      var subseriesBlock = row.closest(".subseries-block");
      var subseriesTitle =
        subseriesBlock && subseriesBlock.querySelector(".subseries-title");

      return Boolean(
        subseriesBlock &&
          subseriesTitle &&
          subseriesTitle.textContent.trim() === subseriesName
      );
    }

    return !row.closest(".subseries-block");
  }

  function resolveCurrentRow() {
    var rows = Array.from(document.querySelectorAll(".admin-story-row"));
    currentRow = rows.find(matchesCurrentStory) || null;
    return currentRow;
  }

  function getStorySongTool() {
    if (!currentRow || !document.contains(currentRow)) {
      resolveCurrentRow();
    }

    return currentRow
      ? currentRow.querySelector(".story-ending-song-tool")
      : null;
  }

  function ensureButton() {
    var actions = document.querySelector("#storyWorkspace .workspace-actions");
    if (!actions) return null;

    var existing = $("storyWorkspaceSongBtn");
    if (existing) return existing;

    var button = document.createElement("button");
    button.id = "storyWorkspaceSongBtn";
    button.type = "button";
    button.className = "quiet-action";
    button.textContent = "♪ Song";
    button.title = "Ending song for this Story";

    button.addEventListener("click", function () {
      var tool = getStorySongTool();
      if (tool) {
        tool.click();
        return;
      }

      window.clearTimeout(resolveTimer);
      resolveTimer = window.setTimeout(function () {
        var retry = getStorySongTool();
        if (retry) {
          retry.click();
          return;
        }

        toast("Save this Story first, then add its song.", true);
      }, 180);
    });

    var save = $("saveStoryBtn");
    actions.insertBefore(button, save || actions.firstChild);
    return button;
  }

  function syncWorkspace() {
    var workspace = $("storyWorkspace");
    var button = ensureButton();
    if (!workspace || !button) return;

    if (workspace.hidden) {
      button.hidden = true;
      currentRow = null;
      return;
    }

    button.hidden = false;
    currentRow = null;

    window.clearTimeout(resolveTimer);
    resolveTimer = window.setTimeout(function () {
      resolveCurrentRow();
    }, 120);
  }

  function init() {
    var workspace = $("storyWorkspace");
    if (!workspace) return;

    ensureButton();

    var observer = new MutationObserver(syncWorkspace);
    observer.observe(workspace, {
      attributes: true,
      attributeFilter: ["hidden"],
    });

    var library = $("adminSeriesList");
    if (library) {
      var libraryObserver = new MutationObserver(function () {
        if (!workspace.hidden && !currentRow) {
          window.clearTimeout(resolveTimer);
          resolveTimer = window.setTimeout(resolveCurrentRow, 80);
        }
      });
      libraryObserver.observe(library, { childList: true, subtree: true });
    }

    syncWorkspace();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
