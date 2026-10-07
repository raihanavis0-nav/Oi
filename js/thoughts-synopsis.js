(function () {
  "use strict";

  var SYNOPSIS_MAX = 1500;
  var synopsisCache = new Map();
  var listScheduled = false;
  var readerLoadedSlug = "";

  function $(id) {
    return document.getElementById(id);
  }

  function slugify(value) {
    return String(value || "")
      .toLowerCase()
      .trim()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 90);
  }

  function loadStyles() {
    if (document.querySelector('link[href="css/thoughts-synopsis.css"]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "css/thoughts-synopsis.css";
    document.head.appendChild(link);
  }

  function requestUrl(input) {
    if (typeof input === "string") return input;
    if (input && typeof input.url === "string") return input.url;
    return "";
  }

  function isAdminContentEndpoint(input) {
    try {
      var parsed = new URL(requestUrl(input), window.location.href);
      return (
        parsed.origin === window.location.origin &&
        parsed.pathname === "/api/thoughts-admin/content"
      );
    } catch (_) {
      return false;
    }
  }

  function adminUiData() {
    var sync = window.ThoughtsContentSync;
    if (!sync) return null;
    if (typeof sync.getUiData === "function") return sync.getUiData();
    if (typeof sync.getSnapshot === "function") {
      var snapshot = sync.getSnapshot();
      return snapshot && snapshot.data ? snapshot.data : null;
    }
    return null;
  }

  function findAdminStory(data) {
    var stories = data && Array.isArray(data.stories) ? data.stories : [];
    var slugInput = $("storySlugInput");
    var titleInput = $("storyTitleInput");
    var dateInput = $("storyDateInput");
    var seriesInput = $("storySeriesInput");
    var subseriesInput = $("storySubseriesInput");
    var slug = String((slugInput && slugInput.value) || "").trim();

    if (slug) {
      var bySlug = stories.find(function (story) {
        return story && story.slug === slug;
      });
      if (bySlug) return bySlug;
    }

    var title = String((titleInput && titleInput.value) || "").trim();
    var date = String((dateInput && dateInput.value) || "");
    var seriesId = String((seriesInput && seriesInput.value) || "");
    var subseriesId = String((subseriesInput && subseriesInput.value) || "");

    if (!title) return null;

    var matches = stories.filter(function (story) {
      return (
        story &&
        story.title === title &&
        String(story.date || "") === date &&
        String(story.seriesId || "") === seriesId &&
        String(story.subseriesId || "") === subseriesId
      );
    });

    return matches.length === 1 ? matches[0] : null;
  }

  function syncAdminSynopsis() {
    var input = $("storySynopsisInput");
    var workspace = $("storyWorkspace");
    if (!input || !workspace || workspace.hidden) return;

    var story = findAdminStory(adminUiData());
    if (!story) {
      input.value = "";
      input.dataset.storyId = "";
      return;
    }

    var id = String(story.id || "");
    input.dataset.storyId = id;
    input.value = synopsisCache.has(id)
      ? synopsisCache.get(id)
      : String(story.synopsis || "");
  }

  function markAdminDirty() {
    var title = $("storyTitleInput");
    if (title) title.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function createAdminField() {
    var title = $("storyTitleInput");
    if (!title || $("storySynopsisInput")) return;

    var input = document.createElement("textarea");
    input.id = "storySynopsisInput";
    input.className = "story-synopsis-input";
    input.rows = 2;
    input.maxLength = SYNOPSIS_MAX;
    input.placeholder = "Synopsis…";
    input.setAttribute("aria-label", "Story synopsis");
    input.setAttribute("spellcheck", "true");
    title.insertAdjacentElement("afterend", input);
    input.addEventListener("input", markAdminDirty);

    var workspace = $("storyWorkspace");
    if (workspace) {
      new MutationObserver(function () {
        if (!workspace.hidden) {
          requestAnimationFrame(function () {
            requestAnimationFrame(syncAdminSynopsis);
          });
        }
      }).observe(workspace, {
        attributes: true,
        attributeFilter: ["hidden"],
      });
    }

    requestAnimationFrame(syncAdminSynopsis);
  }

  function preserveKnownSynopses(data) {
    if (!data || !Array.isArray(data.stories)) return;

    var sourceData = adminUiData();
    var sourceStories =
      sourceData && Array.isArray(sourceData.stories) ? sourceData.stories : [];
    var sourceById = new Map(
      sourceStories.filter(Boolean).map(function (story) {
        return [String(story.id || ""), story];
      })
    );

    data.stories.forEach(function (story) {
      if (!story || !story.id) return;
      var id = String(story.id);

      if (synopsisCache.has(id)) {
        story.synopsis = synopsisCache.get(id);
        return;
      }

      var source = sourceById.get(id);
      if (source && Object.prototype.hasOwnProperty.call(source, "synopsis")) {
        story.synopsis = String(source.synopsis || "").slice(0, SYNOPSIS_MAX);
      }
    });
  }

  function injectCurrentSynopsis(payload) {
    var input = $("storySynopsisInput");
    var stories = payload && payload.data && Array.isArray(payload.data.stories)
      ? payload.data.stories
      : [];
    if (!input || !stories.length) return;

    var slugInput = $("storySlugInput");
    var titleInput = $("storyTitleInput");
    var slug = slugify(
      String((slugInput && slugInput.value) || "") ||
        String((titleInput && titleInput.value) || "")
    );
    var currentId = String(input.dataset.storyId || "");
    var target = stories.find(function (story) {
      return story && currentId && String(story.id) === currentId;
    });

    if (!target && slug) {
      target = stories.find(function (story) {
        return story && story.slug === slug;
      });
    }
    if (!target) return;

    var synopsis = String(input.value || "").trim().slice(0, SYNOPSIS_MAX);
    target.synopsis = synopsis;
    if (target.id) {
      var id = String(target.id);
      synopsisCache.set(id, synopsis);
      input.dataset.storyId = id;
    }
  }

  function installAdminSaveBridge() {
    if (!$("adminApp") || window.__thoughtsSynopsisFetchBridge) return;
    window.__thoughtsSynopsisFetchBridge = true;

    var previousFetch = window.fetch.bind(window);

    window.fetch = function (input, init) {
      var method = String((init && init.method) || "GET").toUpperCase();
      if (
        method !== "PUT" ||
        !isAdminContentEndpoint(input) ||
        !init ||
        typeof init.body !== "string"
      ) {
        return previousFetch(input, init);
      }

      var payload;
      try {
        payload = JSON.parse(init.body);
      } catch (_) {
        return previousFetch(input, init);
      }

      if (!payload || !payload.data) return previousFetch(input, init);

      preserveKnownSynopses(payload.data);
      if (String(payload.message || "").startsWith("stories: save ")) {
        injectCurrentSynopsis(payload);
      }

      return previousFetch(
        input,
        Object.assign({}, init, { body: JSON.stringify(payload) })
      ).then(function (response) {
        if (response.ok) scheduleAdminLibrarySynopses();
        return response;
      });
    };
  }

  function renderAdminLibrarySynopses() {
    listScheduled = false;
    var host = $("adminSeriesList");
    var data = adminUiData();
    if (!host || !data || !Array.isArray(data.stories)) return;

    var storiesById = new Map(
      data.stories.filter(Boolean).map(function (story) {
        return [String(story.id || ""), story];
      })
    );

    Array.from(host.querySelectorAll(".admin-story-row[data-sort-id]")).forEach(
      function (row) {
        var id = String(row.getAttribute("data-sort-id") || "");
        var story = storiesById.get(id);
        if (!story) return;

        var text = synopsisCache.has(id)
          ? synopsisCache.get(id)
          : String(story.synopsis || "").trim();
        var synopsis = row.querySelector(":scope > .admin-story-synopsis");

        row.classList.toggle("has-story-synopsis", Boolean(text));

        if (!text) {
          if (synopsis) synopsis.remove();
          return;
        }

        if (!synopsis) {
          synopsis = document.createElement("p");
          synopsis.className = "admin-story-synopsis";
          synopsis.setAttribute("aria-label", "Synopsis");
          row.appendChild(synopsis);
        }

        if (synopsis.textContent !== text) synopsis.textContent = text;
        if (synopsis.title !== text) synopsis.title = text;
      }
    );
  }

  function scheduleAdminLibrarySynopses() {
    if (listScheduled) return;
    listScheduled = true;
    requestAnimationFrame(renderAdminLibrarySynopses);
  }

  function watchAdminLibrarySynopses() {
    var host = $("adminSeriesList");
    if (!host) return;

    new MutationObserver(function () {
      scheduleAdminLibrarySynopses();
    }).observe(host, { childList: true, subtree: true });

    scheduleAdminLibrarySynopses();
  }

  function currentReaderSlug() {
    return new URLSearchParams(window.location.search).get("story") || "";
  }

  function ensureReaderElement() {
    var title = $("storyTitle");
    if (!title) return null;

    var synopsis = $("storySynopsis");
    if (synopsis) return synopsis;

    synopsis = document.createElement("p");
    synopsis.id = "storySynopsis";
    synopsis.className = "story-synopsis";
    synopsis.hidden = true;
    title.insertAdjacentElement("afterend", synopsis);
    return synopsis;
  }

  function hideReaderSynopsis() {
    var synopsis = ensureReaderElement();
    if (!synopsis) return;
    synopsis.textContent = "";
    synopsis.hidden = true;
  }

  function renderReaderSynopsis(force) {
    var slug = currentReaderSlug();
    var storyView = $("storyView");
    var synopsis = ensureReaderElement();

    if (!storyView || !synopsis || !slug || storyView.hidden) {
      hideReaderSynopsis();
      return;
    }

    if (!force && readerLoadedSlug === slug) return;
    readerLoadedSlug = slug;

    fetch("/api/thoughts/content", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(function (response) {
        if (!response.ok) throw new Error("Could not load synopsis.");
        return response.json();
      })
      .then(function (result) {
        if (currentReaderSlug() !== slug) return;
        var stories =
          result && result.data && Array.isArray(result.data.stories)
            ? result.data.stories
            : [];
        var story = stories.find(function (item) {
          return item && item.slug === slug;
        });
        var text = story ? String(story.synopsis || "").trim() : "";
        synopsis.textContent = text;
        synopsis.hidden = !text;
      })
      .catch(function () {
        if (currentReaderSlug() === slug) hideReaderSynopsis();
      });
  }

  function initReader() {
    if (!$("libraryApp")) return;
    ensureReaderElement();

    var storyView = $("storyView");
    if (storyView) {
      new MutationObserver(function () {
        readerLoadedSlug = "";
        renderReaderSynopsis(true);
      }).observe(storyView, {
        attributes: true,
        attributeFilter: ["hidden"],
      });
    }

    window.addEventListener("popstate", function () {
      readerLoadedSlug = "";
      renderReaderSynopsis(true);
    });
    renderReaderSynopsis(true);
  }

  function initAdmin() {
    if (!$("adminApp")) return;
    createAdminField();
    installAdminSaveBridge();
    watchAdminLibrarySynopses();
  }

  function init() {
    loadStyles();
    initAdmin();
    initReader();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
