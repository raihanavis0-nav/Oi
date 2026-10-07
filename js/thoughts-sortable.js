(function () {
  "use strict";

  var API = "/api/thoughts-admin/content";
  var drag = null;
  var saving = false;
  var queued = false;
  var reconciling = false;

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function sortByOrderName(a, b) {
    var order = Number(a.order || 0) - Number(b.order || 0);
    if (order) return order;
    return String(a.name || a.title || "").localeCompare(
      String(b.name || b.title || "")
    );
  }

  function sortStories(a, b) {
    var order = Number(a.order || 0) - Number(b.order || 0);
    if (order) return order;
    var date = String(a.date || "").localeCompare(String(b.date || ""));
    if (date) return date;
    return String(a.title || "").localeCompare(String(b.title || ""));
  }

  function sync() {
    return window.ThoughtsContentSync || null;
  }

  function savedSnapshot() {
    var api = sync();
    if (!api) return null;
    var value = api.getSnapshot();
    return value && value.revision && value.data ? value : null;
  }

  function renderedData() {
    var api = sync();
    if (api && api.getUiData) return api.getUiData();
    var current = savedSnapshot();
    return current ? current.data : null;
  }

  function refresh() {
    return fetch(API, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    }).then(function (response) {
      if (!response.ok) throw new Error("Could not load order data.");
      return response.json();
    });
  }

  function getSnapshot() {
    var current = savedSnapshot();
    if (current) return Promise.resolve(current);
    return refresh().then(function () {
      var next = savedSnapshot();
      if (!next) throw new Error("Order state is unavailable.");
      return next;
    });
  }

  function children(container, selector) {
    if (!container) return [];
    return Array.from(container.children).filter(function (node) {
      return node.matches(selector);
    });
  }

  function ids(container, selector) {
    return children(container, selector)
      .map(function (node) {
        return node.getAttribute("data-sort-id") || "";
      })
      .filter(Boolean);
  }

  function nodeForId(nodes, id, fallbackIndex) {
    var wanted = String(id || "");
    var exact = nodes.find(function (node) {
      return String(node.getAttribute("data-sort-id") || "") === wanted;
    });
    if (exact) return exact;

    var fallback = nodes[fallbackIndex];
    if (!fallback) return null;

    var existing = String(fallback.getAttribute("data-sort-id") || "");
    if (existing && existing !== wanted) return null;

    fallback.setAttribute("data-sort-id", wanted);
    return fallback;
  }

  function sameIdSet(left, right) {
    if (left.length !== right.length) return false;
    var expected = new Set(right.map(String));
    return left.every(function (id) {
      return expected.has(String(id));
    });
  }

  function scopeIds(kind, data, orderedIds) {
    var key = collectionName(kind);
    var list = Array.isArray(data[key]) ? data[key] : [];

    if (kind === "series") {
      return list.filter(Boolean).map(function (item) {
        return item.id;
      });
    }

    var first = list.find(function (item) {
      return item && String(item.id) === String(orderedIds[0] || "");
    });
    if (!first) return [];

    return list
      .filter(function (item) {
        if (!item) return false;
        if (kind === "chapters") {
          return String(item.seriesId || "") === String(first.seriesId || "");
        }
        if (kind === "characters") {
          return String(item.seriesId || "") === String(first.seriesId || "");
        }
        return (
          String(item.seriesId || "") === String(first.seriesId || "") &&
          String(item.subseriesId || "") === String(first.subseriesId || "")
        );
      })
      .map(function (item) {
        return item.id;
      });
  }

  function validateOrderScope(kind, data, orderedIds) {
    if (new Set(orderedIds.map(String)).size !== orderedIds.length) {
      throw new Error("Order list contains duplicate items.");
    }

    var expected = scopeIds(kind, data, orderedIds);
    if (!sameIdSet(orderedIds, expected)) {
      throw new Error("Order list changed while sorting. Reloading latest order.");
    }
  }

  function indicator(text, mode) {
    var node = document.getElementById("saveIndicator");
    if (!node) return;
    node.textContent = text;
    node.classList.toggle("is-saving", mode === "saving");
    node.classList.toggle("is-error", mode === "error");
  }

  function loadStyles() {
    if (document.querySelector('link[href="css/thoughts-sortable.css"]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "css/thoughts-sortable.css";
    document.head.appendChild(link);
  }

  function hideOrderInputs() {
    var field = document.getElementById("entityOrderField");
    if (field) field.hidden = true;
    var storyOrder = document.getElementById("storyOrderInput");
    if (storyOrder && storyOrder.closest(".dialog-field")) {
      storyOrder.closest(".dialog-field").hidden = true;
    }
  }

  function renumberStories(list) {
    children(list, ".admin-story-row").forEach(function (row, index) {
      var number = row.querySelector(".story-index");
      if (number) number.textContent = String(index + 1).padStart(2, "0");
    });
  }

  function collectionName(kind) {
    if (kind === "series") return "series";
    if (kind === "chapters") return "subseries";
    if (kind === "characters") return "characters";
    return "stories";
  }

  function saveOrder(kind, container, selector) {
    if (saving) return Promise.resolve();
    var orderedIds = ids(container, selector);
    if (!orderedIds.length) return Promise.resolve();

    saving = true;
    container.classList.add("is-order-saving");
    indicator("Saving order…", "saving");

    return getSnapshot()
      .then(function (current) {
        var data = clone(current.data);
        validateOrderScope(kind, data, orderedIds);

        var position = new Map(
          orderedIds.map(function (id, index) {
            return [id, index + 1];
          })
        );
        var list = data[collectionName(kind)] || [];
        list.forEach(function (item) {
          if (item && position.has(item.id)) item.order = position.get(item.id);
        });

        return fetch(API, {
          method: "PUT",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            revision: current.revision,
            data: data,
            message: "stories: reorder " + kind,
          }),
        });
      })
      .then(function (response) {
        return response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (body) {
            if (!response.ok) throw new Error(body.error || "Could not save order.");
            indicator("Saved", "ok");
          });
      })
      .catch(function (error) {
        indicator("Order save failed", "error");
        console.error("Thoughts reorder:", error);
        window.setTimeout(function () {
          window.location.reload();
        }, 900);
      })
      .finally(function () {
        saving = false;
        container.classList.remove("is-order-saving");
        schedule();
      });
  }

  function siblings(container, selector, exclude) {
    return children(container, selector).filter(function (node) {
      return node !== exclude;
    });
  }

  function placeVertical(container, selector, placeholder, item, y) {
    var list = siblings(container, selector, item);
    var before = list.find(function (node) {
      var rect = node.getBoundingClientRect();
      return y < rect.top + rect.height / 2;
    });
    if (before) {
      container.insertBefore(placeholder, before);
    } else if (list.length) {
      container.insertBefore(placeholder, list[list.length - 1].nextSibling);
    }
  }

  function placeGrid(container, selector, placeholder, item, x, y) {
    var target = document.elementFromPoint(x, y);
    target = target && target.closest ? target.closest(selector) : null;

    if (target && target !== item && target.parentNode === container) {
      var rect = target.getBoundingClientRect();
      var before =
        y < rect.top + rect.height / 2 ||
        (Math.abs(y - (rect.top + rect.height / 2)) < rect.height * 0.46 &&
          x < rect.left + rect.width / 2);
      container.insertBefore(placeholder, before ? target : target.nextSibling);
      return;
    }

    var list = siblings(container, selector, item);
    var nearest = null;
    var distance = Infinity;
    list.forEach(function (node) {
      var rect = node.getBoundingClientRect();
      var dx = rect.left + rect.width / 2 - x;
      var dy = rect.top + rect.height / 2 - y;
      var nextDistance = dx * dx + dy * dy;
      if (nextDistance < distance) {
        distance = nextDistance;
        nearest = { node: node, rect: rect };
      }
    });

    if (!nearest) return;
    var beforeNearest =
      y < nearest.rect.top + nearest.rect.height / 2 ||
      (Math.abs(y - (nearest.rect.top + nearest.rect.height / 2)) <
        nearest.rect.height * 0.46 &&
        x < nearest.rect.left + nearest.rect.width / 2);
    container.insertBefore(
      placeholder,
      beforeNearest ? nearest.node : nearest.node.nextSibling
    );
  }

  function scrollNearEdge(y) {
    var edge = 86;
    if (y < edge) {
      window.scrollBy(0, -Math.max(7, (edge - y) * 0.2));
    } else if (y > window.innerHeight - edge) {
      window.scrollBy(0, Math.max(7, (y - (window.innerHeight - edge)) * 0.2));
    }
  }

  function ghost(config, rect, x, y) {
    var node = document.createElement("div");
    node.className = "unified-sort-ghost unified-sort-ghost-" + config.kind;
    node.textContent = config.label || "Move";
    node.style.left = x + 14 + "px";
    node.style.top = y + 14 + "px";
    node.style.maxWidth = Math.min(Math.max(rect.width, 150), 360) + "px";
    document.body.appendChild(node);
    return node;
  }

  function beginDrag(event, item, config) {
    if (saving || drag) return;
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    var container = config.container;
    var selector = config.selector;
    var originalIndex = children(container, selector).indexOf(item);
    var rect = item.getBoundingClientRect();
    var placeholder = document.createElement("div");
    placeholder.className =
      "unified-sort-placeholder unified-sort-placeholder-" + config.kind;
    placeholder.style.width = rect.width + "px";
    placeholder.style.height = rect.height + "px";
    container.insertBefore(placeholder, item);

    item.style.display = "none";
    var floating = ghost(config, rect, event.clientX, event.clientY);
    var handle = event.currentTarget;
    var startX = event.clientX;
    var startY = event.clientY;
    var moved = false;

    handle.classList.add("is-grabbing");
    document.body.classList.add("is-library-sorting");
    drag = {
      item: item,
      container: container,
      selector: selector,
      placeholder: placeholder,
      ghost: floating,
      originalIndex: originalIndex,
    };

    function move(nextEvent) {
      if (!drag) return;
      if (
        Math.abs(nextEvent.clientX - startX) +
          Math.abs(nextEvent.clientY - startY) >
        4
      ) {
        moved = true;
      }
      if (!moved) return;

      nextEvent.preventDefault();
      floating.style.left = nextEvent.clientX + 14 + "px";
      floating.style.top = nextEvent.clientY + 14 + "px";
      scrollNearEdge(nextEvent.clientY);

      if (config.axis === "grid") {
        placeGrid(
          container,
          selector,
          placeholder,
          item,
          nextEvent.clientX,
          nextEvent.clientY
        );
      } else {
        placeVertical(container, selector, placeholder, item, nextEvent.clientY);
      }
    }

    function restoreOriginal() {
      var list = siblings(container, selector, item);
      if (originalIndex >= list.length) {
        if (list.length) container.insertBefore(placeholder, list[list.length - 1].nextSibling);
      } else {
        container.insertBefore(placeholder, list[originalIndex]);
      }
    }

    function finish(cancelled) {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      if (!drag) return;

      if (cancelled) restoreOriginal();
      container.insertBefore(item, placeholder);
      item.style.display = "";
      placeholder.remove();
      floating.remove();
      handle.classList.remove("is-grabbing");
      document.body.classList.remove("is-library-sorting");

      var nextIndex = children(container, selector).indexOf(item);
      var changed = moved && !cancelled && nextIndex !== originalIndex;
      drag = null;

      if (config.kind === "stories") renumberStories(container);
      if (changed) saveOrder(config.kind, container, selector);
    }

    function up(upEvent) {
      if (upEvent.button != null && upEvent.button !== 0) return;
      finish(false);
    }

    function cancel() {
      finish(true);
    }

    window.addEventListener("pointermove", move, { capture: true, passive: false });
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
  }

  function keyboardMove(event, item, config) {
    if (saving) return;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].indexOf(event.key) < 0) {
      return;
    }

    event.preventDefault();
    var list = children(config.container, config.selector);
    var index = list.indexOf(item);
    var backward = event.key === "ArrowUp" || event.key === "ArrowLeft";
    var targetIndex = backward ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= list.length) return;

    if (backward) {
      config.container.insertBefore(item, list[targetIndex]);
    } else {
      config.container.insertBefore(item, list[targetIndex].nextSibling);
    }

    if (config.kind === "stories") renumberStories(config.container);
    saveOrder(config.kind, config.container, config.selector);
    var handle = item.querySelector(".unified-sort-handle-" + config.kind);
    if (handle) handle.focus();
  }

  function makeHandle(item, config, label) {
    var existing = item.querySelector(".unified-sort-handle-" + config.kind);
    if (existing) return existing;

    var handle = document.createElement("button");
    handle.type = "button";
    handle.className =
      "unified-sort-handle unified-sort-handle-" + config.kind;
    handle.textContent = "⠿";
    handle.title = "Drag to reorder";
    handle.setAttribute("aria-label", "Reorder " + label);

    var dragConfig = Object.assign({}, config, { label: label });
    handle.addEventListener("pointerdown", function (nextEvent) {
      beginDrag(nextEvent, item, dragConfig);
    });
    handle.addEventListener("keydown", function (nextEvent) {
      keyboardMove(nextEvent, item, config);
    });
    item.insertBefore(handle, item.firstChild);
    return handle;
  }

  function wireStoryList(list, stories) {
    if (!list) return;
    var rows = children(list, ".admin-story-row");
    stories.slice().sort(sortStories).forEach(function (story, index) {
      var row = nodeForId(rows, story.id, index);
      if (!row) return;
      makeHandle(
        row,
        {
          kind: "stories",
          axis: "vertical",
          container: list,
          selector: ".admin-story-row",
        },
        story.title || "Story"
      );
    });
    renumberStories(list);
  }

  function wireSeries(data) {
    var host = document.getElementById("adminSeriesList");
    if (!host) return;
    var blocks = children(host, ".admin-series-block");

    (data.series || []).slice().sort(sortByOrderName).forEach(function (series, index) {
      var block = nodeForId(blocks, series.id, index);
      if (!block) return;

      var titleRow = block.querySelector(":scope > .series-title-row");
      if (titleRow) {
        var seriesHandle = makeHandle(
          block,
          {
            kind: "series",
            axis: "vertical",
            container: host,
            selector: ".admin-series-block",
          },
          series.name || "Series"
        );
        if (seriesHandle.parentNode !== titleRow) {
          titleRow.insertBefore(seriesHandle, titleRow.firstChild);
        }
      }

      var directStories = (data.stories || []).filter(function (story) {
        return story.seriesId === series.id && !story.subseriesId;
      });
      wireStoryList(block.querySelector(":scope > .story-list"), directStories);

      var chapters = (data.subseries || [])
        .filter(function (chapter) {
          return chapter.seriesId === series.id;
        })
        .sort(sortByOrderName);
      var chapterBlocks = children(block, ".subseries-block");

      chapters.forEach(function (chapter, chapterIndex) {
        var chapterBlock = nodeForId(chapterBlocks, chapter.id, chapterIndex);
        if (!chapterBlock) return;

        var head = chapterBlock.querySelector(":scope > .admin-subseries-title-row");
        if (head) {
          var chapterHandle = makeHandle(
            chapterBlock,
            {
              kind: "chapters",
              axis: "vertical",
              container: block,
              selector: ".subseries-block",
            },
            chapter.name || "Chapter"
          );
          if (chapterHandle.parentNode !== head) {
            head.insertBefore(chapterHandle, head.firstChild);
          }
        }

        var nestedStories = (data.stories || []).filter(function (story) {
          return story.subseriesId === chapter.id;
        });
        wireStoryList(
          chapterBlock.querySelector(":scope > .story-list"),
          nestedStories
        );
      });
    });
  }

  function wireCharacters(data) {
    var grid = document.getElementById("adminCharacterGrid");
    if (!grid || grid.querySelector(":scope > .character-card")) return;

    Array.from(grid.querySelectorAll(":scope > .character-series-group")).forEach(
      function (group) {
        children(group, ".admin-character-card").forEach(function (card) {
          var id = card.getAttribute("data-character-id");
          if (!id) return;
          var character = (data.characters || []).find(function (item) {
            return item.id === id;
          });
          card.setAttribute("data-sort-id", id);
          makeHandle(
            card,
            {
              kind: "characters",
              axis: "grid",
              container: group,
              selector: ".admin-character-card",
            },
            (character && character.name) || "Character"
          );
        });
      }
    );
  }

  function reorderChildren(container, selector, desiredIds) {
    var list = children(container, selector);
    if (list.length < 2) return;
    var nodes = new Map(
      list.map(function (node) {
        return [node.getAttribute("data-sort-id"), node];
      })
    );
    var ordered = desiredIds
      .map(function (id) {
        return nodes.get(id);
      })
      .filter(Boolean);
    list.forEach(function (node) {
      if (ordered.indexOf(node) === -1) ordered.push(node);
    });

    var marker = document.createComment("sort-position");
    container.insertBefore(marker, list[0]);
    ordered.forEach(function (node) {
      container.insertBefore(node, marker);
    });
    marker.remove();
  }

  function reconcileSeries(data) {
    var host = document.getElementById("adminSeriesList");
    if (!host) return;

    var seriesIds = (data.series || [])
      .slice()
      .sort(sortByOrderName)
      .map(function (series) {
        return series.id;
      });
    reorderChildren(host, ".admin-series-block", seriesIds);

    children(host, ".admin-series-block").forEach(function (block) {
      var seriesId = block.getAttribute("data-sort-id");
      if (!seriesId) return;

      var directList = block.querySelector(":scope > .story-list");
      var directIds = (data.stories || [])
        .filter(function (story) {
          return story.seriesId === seriesId && !story.subseriesId;
        })
        .sort(sortStories)
        .map(function (story) {
          return story.id;
        });
      reorderChildren(directList, ".admin-story-row", directIds);
      renumberStories(directList);

      var chapterIds = (data.subseries || [])
        .filter(function (chapter) {
          return chapter.seriesId === seriesId;
        })
        .sort(sortByOrderName)
        .map(function (chapter) {
          return chapter.id;
        });
      reorderChildren(block, ".subseries-block", chapterIds);

      children(block, ".subseries-block").forEach(function (chapterBlock) {
        var chapterId = chapterBlock.getAttribute("data-sort-id");
        var nestedList = chapterBlock.querySelector(":scope > .story-list");
        var nestedIds = (data.stories || [])
          .filter(function (story) {
            return story.subseriesId === chapterId;
          })
          .sort(sortStories)
          .map(function (story) {
            return story.id;
          });
        reorderChildren(nestedList, ".admin-story-row", nestedIds);
        renumberStories(nestedList);
      });
    });
  }

  function reconcileCharacters(data) {
    var grid = document.getElementById("adminCharacterGrid");
    if (!grid || grid.querySelector(":scope > .character-card")) return;

    var groups = Array.from(
      grid.querySelectorAll(":scope > .character-series-group")
    );
    if (!groups.length) return;

    var groupByName = new Map(
      groups.map(function (group) {
        return [group.getAttribute("data-character-series"), group];
      })
    );
    var desiredNames = (data.series || [])
      .slice()
      .sort(sortByOrderName)
      .map(function (series) {
        return series.name;
      });
    desiredNames.push("Global / Unassigned");

    var desiredGroups = desiredNames
      .map(function (name) {
        return groupByName.get(name);
      })
      .filter(Boolean);
    groups.forEach(function (group) {
      if (desiredGroups.indexOf(group) === -1) desiredGroups.push(group);
    });

    var marker = document.createComment("group-position");
    grid.insertBefore(marker, groups[0]);
    desiredGroups.forEach(function (group) {
      grid.insertBefore(group, marker);
    });
    marker.remove();

    desiredGroups.forEach(function (group) {
      var cardIds = new Set(
        children(group, ".admin-character-card").map(function (card) {
          return card.getAttribute("data-sort-id");
        })
      );
      var desired = (data.characters || [])
        .filter(function (character) {
          return cardIds.has(character.id);
        })
        .sort(sortByOrderName)
        .map(function (character) {
          return character.id;
        });
      reorderChildren(group, ".admin-character-card", desired);
    });
  }

  function reconcile(data) {
    if (!data || drag || saving) return;
    reconciling = true;
    reconcileSeries(data);
    reconcileCharacters(data);
    requestAnimationFrame(function () {
      reconciling = false;
    });
  }

  function wire() {
    queued = false;
    if (drag || saving || reconciling) return;
    hideOrderInputs();

    var current = savedSnapshot();
    if (!current) {
      refresh().then(schedule).catch(function (error) {
        console.error("Thoughts reorder init:", error);
      });
      return;
    }

    var ui = renderedData() || current.data;
    wireSeries(ui);
    wireCharacters(ui);
    reconcile(current.data);
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      requestAnimationFrame(wire);
    });
  }

  function watch() {
    var root = document.getElementById("libraryView");
    if (!root) return;
    new MutationObserver(function () {
      if (!drag && !saving && !reconciling) schedule();
    }).observe(root, { childList: true, subtree: true });
  }

  function init() {
    if (!document.getElementById("adminApp")) return;
    loadStyles();
    hideOrderInputs();
    watch();
    refresh().catch(function () {}).finally(schedule);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
