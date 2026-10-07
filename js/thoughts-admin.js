(function () {
  "use strict";

  var API = {
    content: "/api/thoughts-admin/content",
    upload: "/api/thoughts-admin/upload",
    media: "/api/thoughts-admin/media",
  };

  var state = {
    data: emptyData(),
    revision: "",
    currentStoryId: "",
    storyDraft: null,
    storyIsNew: false,
    dirty: false,
    entityType: "",
    entityId: "",
    entitySlugTouched: false,
    toastTimer: 0,
  };

  function emptyData() {
    return {
      schemaVersion: 2,
      series: [],
      subseries: [],
      characters: [],
      stories: [],
    };
  }

  function $(id) {
    return document.getElementById(id);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
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

  function today() {
    var now = new Date();
    var offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
  }

  function numberValue(value) {
    var parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function apiJson(url, options) {
    options = options || {};
    options.credentials = "same-origin";
    options.headers = Object.assign(
      { Accept: "application/json" },
      options.headers || {}
    );

    if (options.body && !options.headers["Content-Type"]) {
      options.headers["Content-Type"] = "application/json";
    }

    return fetch(url, options).then(function (response) {
      return response
        .json()
        .catch(function () {
          return {};
        })
        .then(function (body) {
          if (!response.ok) {
            var error = new Error(body.error || "Request failed.");
            error.status = response.status;
            if (response.status === 401 && window.archiveAdminAuth) {
              window.archiveAdminAuth.showLogin("Session expired. Enter the password again.");
            }
            throw error;
          }
          return body;
        });
    });
  }

  function setTheme(theme, persist) {
    var next = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = next;

    if (persist) {
      localStorage.setItem("thoughts_theme", next);
    }

    document.querySelectorAll("[data-theme-choice]").forEach(function (button) {
      button.setAttribute(
        "aria-pressed",
        button.getAttribute("data-theme-choice") === next ? "true" : "false"
      );
    });
  }

  function initTheme() {
    var saved = localStorage.getItem("thoughts_theme");
    var preferred =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";

    setTheme(saved || preferred, false);

    document.querySelectorAll("[data-theme-choice]").forEach(function (button) {
      button.addEventListener("click", function () {
        setTheme(button.getAttribute("data-theme-choice"), true);
      });
    });
  }

  function toast(message, isError) {
    var node = $("adminToast");
    if (!node) return;

    window.clearTimeout(state.toastTimer);
    node.textContent = message;
    node.hidden = false;
    node.style.color = isError ? "var(--admin-danger)" : "";

    state.toastTimer = window.setTimeout(function () {
      node.hidden = true;
    }, 3200);
  }

  function setSaveIndicator(text, mode) {
    var node = $("saveIndicator");
    if (!node) return;

    node.textContent = text;
    node.classList.toggle("is-saving", mode === "saving");
    node.classList.toggle("is-error", mode === "error");
  }

  function markDirty() {
    state.dirty = true;
    setSaveIndicator("Unsaved");
  }

  function handleAuthError(error) {
    if (error && error.status === 401 && window.archiveAdminAuth) {
      window.archiveAdminAuth.showLogin("Session expired. Enter the password again.");
      return true;
    }
    return false;
  }

  function normalizeData(data) {
    var source = data && typeof data === "object" ? data : {};
    return {
      schemaVersion: 2,
      series: Array.isArray(source.series) ? source.series : [],
      subseries: Array.isArray(source.subseries) ? source.subseries : [],
      characters: Array.isArray(source.characters) ? source.characters : [],
      stories: Array.isArray(source.stories) ? source.stories : [],
    };
  }

  function loadData() {
    return apiJson(API.content).then(function (result) {
      state.data = normalizeData(result.data);
      state.revision = String(result.revision || "");
      renderLibrary();
      return result;
    });
  }

  function saveCandidate(candidate, message) {
    setSaveIndicator("Saving…", "saving");

    return apiJson(API.content, {
      method: "PUT",
      body: JSON.stringify({
        data: candidate,
        message: message,
        revision: state.revision,
      }),
    })
      .then(function (result) {
        state.data = candidate;
        state.revision = String(result.revision || state.revision);
        state.dirty = false;
        setSaveIndicator("Saved");
        renderLibrary();
        return result;
      })
      .catch(function (error) {
        setSaveIndicator("Save failed", "error");

        if (error && error.status === 409) {
          return loadData().then(function () {
            throw error;
          });
        }

        throw error;
      });
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

  function seriesById(id) {
    return state.data.series.find(function (item) {
      return String(item.id) === String(id);
    });
  }

  function subseriesById(id) {
    return state.data.subseries.find(function (item) {
      return String(item.id) === String(id);
    });
  }

  function characterById(id) {
    return state.data.characters.find(function (item) {
      return String(item.id) === String(id);
    });
  }

  function storyById(id) {
    return state.data.stories.find(function (item) {
      return String(item.id) === String(id);
    });
  }

  function mediaUrl(path) {
    return API.media + "?path=" + encodeURIComponent(String(path || ""));
  }

  function characterInitials(name) {
    var parts = String(name || "?")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

    return (
      parts[0].slice(0, 1) +
      parts[parts.length - 1].slice(0, 1)
    ).toUpperCase();
  }

  function formatDate(iso) {
    var date = new Date(String(iso || "") + "T12:00:00");
    if (Number.isNaN(date.getTime())) return "";

    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
    }).format(date);
  }

  function makeButton(label, className, onClick) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = className || "";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function makeTools() {
    var tools = document.createElement("div");
    tools.className = "admin-row-tools";
    return tools;
  }

  function createAdminStoryList(stories, seriesId, subseriesId) {
    var list = document.createElement("div");
    list.className = "story-list";

    var sorted = stories.slice().sort(sortStories);

    sorted.forEach(function (story, index) {
      var row = document.createElement("div");
      row.className = "story-row admin-story-row";
      row.setAttribute("data-sort-id", story.id);

      var order = document.createElement("span");
      order.className = "story-index";
      var displayOrder =
        Number(story.order || 0) > 0 ? Number(story.order) : index + 1;
      order.textContent = String(displayOrder).padStart(2, "0");

      var open = document.createElement("button");
      open.type = "button";
      open.className = "story-open";
      open.textContent = story.title || "Untitled";
      open.addEventListener("click", function () {
        openStory(story.id);
      });

      var date = document.createElement("time");
      date.dateTime = story.date || "";
      date.textContent = formatDate(story.date);

      var tools = makeTools();
      if (story.published === false) {
        var draft = document.createElement("span");
        draft.className = "draft-label";
        draft.textContent = "Draft";
        tools.appendChild(draft);
      }
      tools.appendChild(
        makeButton("•••", "", function () {
          openStory(story.id);
          openStoryActions();
        })
      );

      row.appendChild(order);
      row.appendChild(open);
      row.appendChild(date);
      row.appendChild(tools);
      list.appendChild(row);
    });

    var add = document.createElement("div");
    add.className = "admin-series-actions";
    add.appendChild(
      makeButton("+ Story", "inline-add", function () {
        openNewStory(seriesId, subseriesId || "");
      })
    );
    list.appendChild(add);

    return list;
  }

  function renderSeries() {
    var host = $("adminSeriesList");
    host.innerHTML = "";

    var seriesItems = state.data.series.slice().sort(sortByOrderName);
    $("seriesEmpty").hidden = seriesItems.length > 0;

    seriesItems.forEach(function (series) {
      var block = document.createElement("section");
      block.className = "series-block admin-series-block";
      block.setAttribute("data-sort-id", series.id);

      var titleRow = document.createElement("div");
      titleRow.className = "series-title-row";

      var title = document.createElement("h3");
      title.className = "series-title";
      title.textContent = series.name || "Untitled series";

      var tools = makeTools();
      var storyCount = state.data.stories.filter(function (story) {
        return story.seriesId === series.id;
      }).length;

      var count = document.createElement("span");
      count.textContent = storyCount + (storyCount === 1 ? " story" : " stories");
      tools.appendChild(count);
      tools.appendChild(
        makeButton("Edit", "", function () {
          openEntity("series", series.id);
        })
      );

      titleRow.appendChild(title);
      titleRow.appendChild(tools);
      block.appendChild(titleRow);

      if (series.description) {
        var description = document.createElement("p");
        description.className = "series-description";
        description.textContent = series.description;
        block.appendChild(description);
      }

      var directStories = state.data.stories.filter(function (story) {
        return story.seriesId === series.id && !story.subseriesId;
      });

      block.appendChild(createAdminStoryList(directStories, series.id, ""));

      state.data.subseries
        .filter(function (subseries) {
          return subseries.seriesId === series.id;
        })
        .sort(sortByOrderName)
        .forEach(function (subseries) {
          var nested = document.createElement("section");
          nested.className = "subseries-block";
          nested.setAttribute("data-sort-id", subseries.id);

          var nestedHead = document.createElement("div");
          nestedHead.className = "admin-subseries-title-row";

          var nestedTitle = document.createElement("h4");
          nestedTitle.className = "subseries-title";
          nestedTitle.textContent = subseries.name || "Untitled sub-series";

          var nestedTools = makeTools();
          nestedTools.appendChild(
            makeButton("Edit", "", function () {
              openEntity("subseries", subseries.id);
            })
          );

          nestedHead.appendChild(nestedTitle);
          nestedHead.appendChild(nestedTools);
          nested.appendChild(nestedHead);

          if (subseries.description) {
            var nestedDescription = document.createElement("p");
            nestedDescription.className = "subseries-description";
            nestedDescription.textContent = subseries.description;
            nested.appendChild(nestedDescription);
          }

          var nestedStories = state.data.stories.filter(function (story) {
            return story.subseriesId === subseries.id;
          });

          nested.appendChild(
            createAdminStoryList(nestedStories, series.id, subseries.id)
          );
          block.appendChild(nested);
        });

      var addSubseries = document.createElement("div");
      addSubseries.className = "admin-series-actions";
      addSubseries.appendChild(
        makeButton("+ Sub-series", "inline-add", function () {
          openEntity("subseries", "", { seriesId: series.id });
        })
      );
      block.appendChild(addSubseries);

      host.appendChild(block);
    });
  }

  function characterMeta(character) {
    var series = seriesById(character.seriesId);
    var subseries = subseriesById(character.subseriesId);
    var parts = [];

    if (series) parts.push(series.name);
    if (subseries) parts.push(subseries.name);
    if (!parts.length) parts.push("Global");

    return parts.join(" / ");
  }

  function saveCharacterOrderFromGrid() {
    var host = $("adminCharacterGrid");
    var ids = Array.from(
      host.querySelectorAll(".admin-character-card[data-character-id]")
    ).map(function (card) {
      return card.getAttribute("data-character-id");
    });

    if (!ids.length) return;

    var candidate = clone(state.data);
    var position = new Map(
      ids.map(function (id, index) {
        return [id, index + 1];
      })
    );

    candidate.characters.forEach(function (character) {
      if (position.has(character.id)) {
        character.order = position.get(character.id);
      }
    });

    host.classList.add("is-saving-order");
    saveCandidate(candidate, "stories: reorder characters")
      .then(function () {
        toast("Character order saved.");
      })
      .catch(function (error) {
        if (handleAuthError(error)) return;
        renderCharacters();
        toast("Could not save Character order: " + error.message, true);
      })
      .finally(function () {
        host.classList.remove("is-saving-order");
      });
  }

  function wireCharacterDrag(handle, card) {
    handle.addEventListener("pointerdown", function (event) {
      if (event.button != null && event.button !== 0) return;

      event.preventDefault();
      event.stopPropagation();

      var startX = event.clientX;
      var startY = event.clientY;
      var moved = false;
      var pointerId = event.pointerId;

      card.classList.add("is-dragging");
      handle.classList.add("is-grabbing");

      try {
        handle.setPointerCapture(pointerId);
      } catch (_) {}

      function move(moveEvent) {
        if (moveEvent.pointerId !== pointerId) return;

        var distance =
          Math.abs(moveEvent.clientX - startX) +
          Math.abs(moveEvent.clientY - startY);

        if (distance > 5) moved = true;
        if (!moved) return;

        moveEvent.preventDefault();

        var target = document
          .elementFromPoint(moveEvent.clientX, moveEvent.clientY)
          ?.closest(".admin-character-card");

        if (!target || target === card || target.parentNode !== card.parentNode) {
          return;
        }

        var rect = target.getBoundingClientRect();
        var centerX = rect.left + rect.width / 2;
        var centerY = rect.top + rect.height / 2;
        var sameRow = Math.abs(moveEvent.clientY - centerY) < rect.height * 0.45;
        var insertBefore = sameRow
          ? moveEvent.clientX < centerX
          : moveEvent.clientY < centerY;

        if (insertBefore) {
          target.parentNode.insertBefore(card, target);
        } else {
          target.parentNode.insertBefore(card, target.nextSibling);
        }
      }

      function end(endEvent) {
        if (endEvent.pointerId !== pointerId) return;

        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);

        try {
          handle.releasePointerCapture(pointerId);
        } catch (_) {}

        card.classList.remove("is-dragging");
        handle.classList.remove("is-grabbing");

        if (moved) {
          saveCharacterOrderFromGrid();
        }
      }

      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    });
  }

  function renderCharacters() {
    var host = $("adminCharacterGrid");
    host.innerHTML = "";

    var characters = state.data.characters
      .slice()
      .sort(sortByOrderName);

    $("charactersEmpty").hidden = characters.length > 0;

    characters.forEach(function (character) {
      var card = document.createElement("article");
      card.className = "character-card admin-character-card";
      card.setAttribute("data-character-id", character.id);
      card.setAttribute("data-sort-id", character.id);

      var dragHandle = makeButton("⋮⋮", "character-drag-handle", function () {});
      dragHandle.setAttribute("aria-label", "Drag to reorder " + (character.name || "Character"));
      dragHandle.setAttribute("title", "Drag to reorder");
      wireCharacterDrag(dragHandle, card);
      card.appendChild(dragHandle);

      var edit = makeButton("Edit", "character-edit-button", function () {
        openEntity("character", character.id);
      });
      card.appendChild(edit);

      if (character.portrait) {
        var image = document.createElement("img");
        image.className = "character-portrait";
        image.src = mediaUrl(character.portrait);
        image.alt = (character.name || "Character") + " portrait";
        image.loading = "lazy";
        card.appendChild(image);
      } else {
        var placeholder = document.createElement("div");
        placeholder.className = "character-portrait-placeholder";
        placeholder.textContent = characterInitials(character.name);
        placeholder.setAttribute("aria-label", "No portrait uploaded");
        card.appendChild(placeholder);
      }

      var name = document.createElement("h3");
      name.textContent = character.name || "Unnamed";
      card.appendChild(name);

      var meta = document.createElement("p");
      meta.className = "character-meta";
      meta.textContent = characterMeta(character);
      card.appendChild(meta);

      if (character.bio) {
        var bio = document.createElement("p");
        bio.className = "character-bio";
        bio.textContent = character.bio;
        card.appendChild(bio);
      }

      host.appendChild(card);
    });
  }

  function syncManagedOrdersBeforeRender() {
    var bridge = window.ThoughtsContentSync;
    if (!bridge || typeof bridge.getSnapshot !== "function") return;

    var latest = bridge.getSnapshot();
    var latestData = latest && latest.data;
    if (!latestData) return;

    ["series", "subseries", "characters", "stories"].forEach(function (key) {
      var source = new Map(
        (Array.isArray(latestData[key]) ? latestData[key] : []).map(function (item) {
          return [item && item.id, item];
        })
      );

      (Array.isArray(state.data[key]) ? state.data[key] : []).forEach(function (item) {
        var saved = item && source.get(item.id);
        if (saved && typeof saved.order === "number") item.order = saved.order;
      });
    });
  }

  function renderLibrary() {
    syncManagedOrdersBeforeRender();
    renderSeries();
    renderCharacters();
  }

  function showLibraryView(force) {
    if (!force && state.dirty) {
      if (!window.confirm("Discard unsaved story changes?")) return;
    }

    state.currentStoryId = "";
    state.storyDraft = null;
    state.storyIsNew = false;
    state.dirty = false;
    setSaveIndicator("Saved");
    $("storyWorkspace").hidden = true;
    $("libraryView").hidden = false;
    renderLibrary();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function fillSeriesSelect(select, selected, blankLabel) {
    select.innerHTML = "";

    if (blankLabel != null) {
      var blank = document.createElement("option");
      blank.value = "";
      blank.textContent = blankLabel;
      select.appendChild(blank);
    }

    state.data.series
      .slice()
      .sort(sortByOrderName)
      .forEach(function (series) {
        var option = document.createElement("option");
        option.value = series.id;
        option.textContent = series.name || "Untitled series";
        select.appendChild(option);
      });

    select.value = selected || "";
  }

  function fillSubseriesSelect(select, seriesId, selected, blankLabel) {
    select.innerHTML = "";

    var blank = document.createElement("option");
    blank.value = "";
    blank.textContent = blankLabel || "No sub-series";
    select.appendChild(blank);

    state.data.subseries
      .filter(function (subseries) {
        return subseries.seriesId === seriesId;
      })
      .sort(sortByOrderName)
      .forEach(function (subseries) {
        var option = document.createElement("option");
        option.value = subseries.id;
        option.textContent = subseries.name || "Untitled sub-series";
        select.appendChild(option);
      });

    select.disabled = !seriesId;
    select.value = selected || "";
  }

  function setPortraitPreview(path) {
    $("portraitPathInput").value = path || "";

    if (!path) {
      $("portraitPreview").hidden = true;
      $("portraitPreview").removeAttribute("src");
      $("portraitPlaceholder").hidden = false;
      return;
    }

    $("portraitPreview").src = mediaUrl(path);
    $("portraitPreview").hidden = false;
    $("portraitPlaceholder").hidden = true;
  }

  function setSeriesCoverPreview(path) {
    $("seriesCoverPathInput").value = path || "";

    if (!path) {
      $("seriesCoverPreview").hidden = true;
      $("seriesCoverPreview").removeAttribute("src");
      $("seriesCoverPlaceholder").hidden = false;
      return;
    }

    $("seriesCoverPreview").src = mediaUrl(path);
    $("seriesCoverPreview").hidden = false;
    $("seriesCoverPlaceholder").hidden = true;
  }

  function uploadSeriesCover() {
    var input = $("seriesCoverFileInput");
    var file = input.files && input.files[0];
    if (!file) return;

    var previousPath = $("seriesCoverPathInput").value || "";
    var previewUrl = URL.createObjectURL(file);
    var preview = $("seriesCoverPreview");

    preview.src = previewUrl;
    preview.hidden = false;
    $("seriesCoverPlaceholder").hidden = true;

    preview.onload = function () {
      URL.revokeObjectURL(previewUrl);
      preview.onload = null;
    };

    $("saveEntityBtn").disabled = true;
    $("entityStatus").textContent = "Uploading book cover…";

    uploadFile(file)
      .then(function (result) {
        setSeriesCoverPreview(result.path);
        input.value = "";
        $("entityStatus").textContent =
          "Book cover ready. Save the Series to keep it.";
      })
      .catch(function (error) {
        input.value = "";
        setSeriesCoverPreview(previousPath);
        if (handleAuthError(error)) return;
        $("entityStatus").textContent =
          "Cover upload failed: " + error.message;
      })
      .finally(function () {
        $("saveEntityBtn").disabled = false;
      });
  }


  function openEntity(type, id, context) {
    context = context || {};
    state.entityType = type;
    state.entityId = id || "";
    state.entitySlugTouched = Boolean(id);

    $("entityTypeInput").value = type;
    $("entityIdInput").value = id || "";
    $("entityStatus").textContent = "";
    $("deleteEntityBtn").hidden = !id;

    var isSeries = type === "series";
    var isSubseries = type === "subseries";
    var isCharacter = type === "character";

    $("entitySeriesField").hidden = isSeries;
    $("entitySubseriesField").hidden = !isCharacter;
    $("entitySlugField").hidden = isCharacter;
    $("entityOrderField").hidden = isCharacter;
    $("seriesCoverField").hidden = !isSeries;
    $("seriesFocusField").hidden = !isSeries;
    $("portraitField").hidden = !isCharacter;

    $("entityDialogTitle").textContent =
      type === "series"
        ? "Series"
        : type === "subseries"
          ? "Sub-series"
          : "Character";
    $("entityEyebrow").textContent = id ? "Edit" : "Create";
    $("entityDescriptionLabel").textContent = isCharacter
      ? "Notes / bio"
      : "Description";

    var item = null;
    if (isSeries) item = seriesById(id);
    if (isSubseries) item = subseriesById(id);
    if (isCharacter) item = characterById(id);

    $("entityNameInput").value = item ? item.name || "" : "";
    $("entitySlugInput").value = item ? item.slug || "" : "";

    var defaultOrder = 0;
    if (isCharacter && !item) {
      defaultOrder =
        state.data.characters.reduce(function (max, character) {
          return Math.max(max, Number(character.order || 0));
        }, 0) + 1;
    }

    $("entityOrderInput").value = String(
      item ? Number(item.order || 0) : defaultOrder
    );
    $("entityDescriptionInput").value = item
      ? isCharacter
        ? item.bio || ""
        : item.description || ""
      : "";

    if (isSeries) {
      setSeriesCoverPreview(item ? item.coverImage || "" : "");
      $("seriesCoverFileInput").value = "";
      $("seriesFocusInput").value =
        item && item.focus === "cover" ? "cover" : "title";
    }

    if (isSubseries) {
      fillSeriesSelect(
        $("entitySeriesInput"),
        item ? item.seriesId : context.seriesId || "",
        "Choose Series"
      );
    }

    if (isCharacter) {
      fillSeriesSelect(
        $("entitySeriesInput"),
        item ? item.seriesId || "" : "",
        "No Series / global"
      );
      fillSubseriesSelect(
        $("entitySubseriesInput"),
        $("entitySeriesInput").value,
        item ? item.subseriesId || "" : "",
        "No sub-series"
      );
      setPortraitPreview(item ? item.portrait || "" : "");
      $("portraitFileInput").value = "";
    }

    $("entityDialog").showModal();
    window.setTimeout(function () {
      $("entityNameInput").focus();
    }, 30);
  }

  function saveEntity() {
    var type = state.entityType;
    var id = state.entityId;
    var name = $("entityNameInput").value.trim();
    var candidate = clone(state.data);

    if (!name) {
      $("entityStatus").textContent = "Name is required.";
      return;
    }

    if (type === "series") {
      var slug = slugify($("entitySlugInput").value || name);
      var duplicate = candidate.series.some(function (item) {
        return item.slug === slug && item.id !== id;
      });

      if (duplicate) {
        $("entityStatus").textContent = "That slug is already in use.";
        return;
      }

      var series = candidate.series.find(function (item) {
        return item.id === id;
      });

      if (!series) {
        series = { id: "series-" + Date.now() };
        candidate.series.push(series);
      }

      series.name = name;
      series.slug = slug;
      series.order = numberValue($("entityOrderInput").value);
      series.description = $("entityDescriptionInput").value.trim();
      series.coverImage = $("seriesCoverPathInput").value || "";
      series.focus = $("seriesFocusInput").value === "cover" ? "cover" : "title";
    }

    if (type === "subseries") {
      var parentSeries = $("entitySeriesInput").value;
      var subSlug = slugify($("entitySlugInput").value || name);

      if (!parentSeries) {
        $("entityStatus").textContent = "Choose a Series.";
        return;
      }

      var subDuplicate = candidate.subseries.some(function (item) {
        return (
          item.seriesId === parentSeries &&
          item.slug === subSlug &&
          item.id !== id
        );
      });

      if (subDuplicate) {
        $("entityStatus").textContent =
          "That slug already exists inside this Series.";
        return;
      }

      var subseries = candidate.subseries.find(function (item) {
        return item.id === id;
      });

      if (!subseries) {
        subseries = { id: "subseries-" + Date.now() };
        candidate.subseries.push(subseries);
      }

      subseries.seriesId = parentSeries;
      subseries.name = name;
      subseries.slug = subSlug;
      subseries.order = numberValue($("entityOrderInput").value);
      subseries.description = $("entityDescriptionInput").value.trim();
    }

    if (type === "character") {
      var characterSeries = $("entitySeriesInput").value;
      var characterSubseries = $("entitySubseriesInput").value;

      if (characterSubseries) {
        var parent = subseriesById(characterSubseries);
        if (!parent || parent.seriesId !== characterSeries) {
          $("entityStatus").textContent =
            "That Sub-series does not belong to the selected Series.";
          return;
        }
      }

      var character = candidate.characters.find(function (item) {
        return item.id === id;
      });

      if (!character) {
        character = { id: "character-" + Date.now() };
        candidate.characters.push(character);
      }

      character.name = name;
      character.seriesId = characterSeries || "";
      character.subseriesId = characterSubseries || "";
      character.order = numberValue($("entityOrderInput").value);
      character.bio = $("entityDescriptionInput").value.trim();
      character.portrait = $("portraitPathInput").value || "";
    }

    $("saveEntityBtn").disabled = true;
    $("entityStatus").textContent = "Saving…";

    saveCandidate(candidate, 'stories: save ' + type + ' "' + name + '"')
      .then(function () {
        $("entityDialog").close();
        toast(
          (type === "character"
            ? "Character"
            : type === "series"
              ? "Series"
              : "Sub-series") + " saved."
        );
      })
      .catch(function (error) {
        if (handleAuthError(error)) return;
        $("entityStatus").textContent = error.message;
      })
      .finally(function () {
        $("saveEntityBtn").disabled = false;
      });
  }

  function deleteEntity() {
    var type = state.entityType;
    var id = state.entityId;
    if (!id) return;

    var candidate = clone(state.data);
    var label = "";

    if (type === "series") {
      var series = seriesById(id);
      if (!series) return;
      label = series.name;

      var seriesInUse =
        candidate.subseries.some(function (item) {
          return item.seriesId === id;
        }) ||
        candidate.stories.some(function (item) {
          return item.seriesId === id;
        }) ||
        candidate.characters.some(function (item) {
          return item.seriesId === id;
        });

      if (seriesInUse) {
        $("entityStatus").textContent =
          "Move or delete its Sub-series, Stories, and Characters first.";
        return;
      }

      candidate.series = candidate.series.filter(function (item) {
        return item.id !== id;
      });
    }

    if (type === "subseries") {
      var subseries = subseriesById(id);
      if (!subseries) return;
      label = subseries.name;

      var subseriesInUse =
        candidate.stories.some(function (item) {
          return item.subseriesId === id;
        }) ||
        candidate.characters.some(function (item) {
          return item.subseriesId === id;
        });

      if (subseriesInUse) {
        $("entityStatus").textContent =
          "Move or delete its Stories and Characters first.";
        return;
      }

      candidate.subseries = candidate.subseries.filter(function (item) {
        return item.id !== id;
      });
    }

    if (type === "character") {
      var character = characterById(id);
      if (!character) return;
      label = character.name;

      candidate.characters = candidate.characters.filter(function (item) {
        return item.id !== id;
      });

      candidate.stories.forEach(function (story) {
        story.characterIds = (story.characterIds || []).filter(function (
          characterId
        ) {
          return characterId !== id;
        });
      });
    }

    if (!window.confirm('Delete "' + label + '"?')) return;

    $("deleteEntityBtn").disabled = true;
    saveCandidate(candidate, 'stories: delete ' + type + ' "' + label + '"')
      .then(function () {
        $("entityDialog").close();
        toast("Deleted.");
      })
      .catch(function (error) {
        if (handleAuthError(error)) return;
        $("entityStatus").textContent = error.message;
      })
      .finally(function () {
        $("deleteEntityBtn").disabled = false;
      });
  }

  function openNewStory(seriesId, subseriesId) {
    if (!state.data.series.length) {
      openEntity("series", "");
      return;
    }

    var selectedSeries =
      seriesId ||
      (state.data.series.length === 1 ? state.data.series[0].id : "");

    state.currentStoryId = "";
    state.storyIsNew = true;
    state.storyDraft = {
      id: "story-" + Date.now(),
      title: "",
      date: today(),
      slug: "",
      seriesId: selectedSeries,
      subseriesId: subseriesId || "",
      order: 0,
      published: false,
      characterIds: [],
      headerImage: "",
      headerImagePosition: 50,
      body: "",
    };

    populateStoryEditor();
  }

  function openStory(id) {
    var story = storyById(id);
    if (!story) return;

    state.currentStoryId = id;
    state.storyIsNew = false;
    state.storyDraft = clone(story);
    populateStoryEditor();
  }

  function populateStoryEditor() {
    var draft = state.storyDraft;
    if (!draft) return;

    $("libraryView").hidden = true;
    $("storyWorkspace").hidden = false;

    fillSeriesSelect(
      $("storySeriesInput"),
      draft.seriesId || "",
      "Choose Series"
    );
    fillSubseriesSelect(
      $("storySubseriesInput"),
      draft.seriesId || "",
      draft.subseriesId || "",
      "No sub-series"
    );

    $("storyDateInput").value = draft.date || today();
    $("storyPublishedInput").checked = draft.published !== false;
    $("storyTitleInput").value = draft.title || "";
    $("storyBodyInput").value = draft.body || "";
    $("storySlugInput").value = draft.slug || "";
    $("storyOrderInput").value = String(draft.order || 0);
    $("storyHeaderPosition").hidden = true;

    renderStoryHeaderImage();
    renderStoryCharacterChips();
    setEditorMode("write");
    state.dirty = false;
    setSaveIndicator(state.storyIsNew ? "New story" : "Saved");

    window.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(function () {
      $("storyTitleInput").focus();
    }, 120);
  }

  function collectStoryDraft() {
    var draft = clone(state.storyDraft || {});
    draft.title = $("storyTitleInput").value.trim();
    draft.date = $("storyDateInput").value || today();
    draft.seriesId = $("storySeriesInput").value;
    draft.subseriesId = $("storySubseriesInput").value || "";
    draft.published = $("storyPublishedInput").checked;
    draft.body = $("storyBodyInput").value.replace(/\s+$/, "");
    draft.slug = slugify($("storySlugInput").value || draft.title);
    draft.order = numberValue($("storyOrderInput").value);
    draft.headerImage = String(draft.headerImage || "");
    draft.headerImagePosition = Math.max(
      0,
      Math.min(100, Number(draft.headerImagePosition == null ? 50 : draft.headerImagePosition))
    );
    draft.characterIds = Array.isArray(draft.characterIds)
      ? draft.characterIds
      : [];

    state.storyDraft = draft;
    return draft;
  }

  function saveStory() {
    var draft = collectStoryDraft();

    if (!draft.title) {
      toast("Story title is required.", true);
      $("storyTitleInput").focus();
      return;
    }

    if (!draft.seriesId) {
      toast("Choose a Series first.", true);
      return;
    }

    if (!draft.slug) {
      toast("Story slug is required.", true);
      return;
    }

    var duplicate = state.data.stories.some(function (story) {
      return story.slug === draft.slug && story.id !== draft.id;
    });

    if (duplicate) {
      toast("That story slug is already in use.", true);
      return;
    }

    if (draft.subseriesId) {
      var subseries = subseriesById(draft.subseriesId);
      if (!subseries || subseries.seriesId !== draft.seriesId) {
        toast("That Sub-series does not belong to this Series.", true);
        return;
      }
    }

    var candidate = clone(state.data);
    var existingIndex = candidate.stories.findIndex(function (story) {
      return story.id === draft.id;
    });

    if (existingIndex >= 0) {
      candidate.stories[existingIndex] = draft;
    } else {
      candidate.stories.push(draft);
    }

    $("saveStoryBtn").disabled = true;

    saveCandidate(candidate, 'stories: save "' + draft.title + '"')
      .then(function () {
        state.currentStoryId = draft.id;
        state.storyIsNew = false;
        state.storyDraft = clone(draft);
        toast("Story saved.");
      })
      .catch(function (error) {
        if (handleAuthError(error)) return;
        toast("Could not save: " + error.message, true);
      })
      .finally(function () {
        $("saveStoryBtn").disabled = false;
      });
  }

  function deleteStory() {
    if (!state.storyDraft) return;

    if (state.storyIsNew) {
      $("storyActionsDialog").close();
      showLibraryView(true);
      return;
    }

    var story = storyById(state.storyDraft.id);
    if (!story) return;

    if (!window.confirm('Delete "' + story.title + '"?')) return;

    var candidate = clone(state.data);
    candidate.stories = candidate.stories.filter(function (item) {
      return item.id !== story.id;
    });

    $("deleteStoryBtn").disabled = true;

    saveCandidate(candidate, 'stories: delete "' + story.title + '"')
      .then(function () {
        $("storyActionsDialog").close();
        showLibraryView(true);
        toast("Story deleted.");
      })
      .catch(function (error) {
        if (handleAuthError(error)) return;
        toast("Could not delete story: " + error.message, true);
      })
      .finally(function () {
        $("deleteStoryBtn").disabled = false;
      });
  }

  function renderStoryCharacterChips() {
    var host = $("storyCharacterChips");
    host.innerHTML = "";

    var ids =
      state.storyDraft && Array.isArray(state.storyDraft.characterIds)
        ? state.storyDraft.characterIds
        : [];

    ids
      .map(characterById)
      .filter(Boolean)
      .forEach(function (character) {
        var chip = document.createElement("span");
        chip.className = "admin-character-chip";

        if (character.portrait) {
          var image = document.createElement("img");
          image.src = mediaUrl(character.portrait);
          image.alt = "";
          chip.appendChild(image);
        } else {
          var placeholder = document.createElement("span");
          placeholder.className = "chip-placeholder";
          placeholder.textContent = String(character.name || "?")
            .slice(0, 1)
            .toUpperCase();
          chip.appendChild(placeholder);
        }

        var name = document.createElement("span");
        name.textContent = character.name || "Unnamed";
        chip.appendChild(name);
        host.appendChild(chip);
      });
  }

  function openCharactersDialog() {
    if (!state.storyDraft) return;

    var host = $("characterPickerList");
    host.innerHTML = "";
    var selected = new Set(state.storyDraft.characterIds || []);

    var characters = state.data.characters
      .slice()
      .sort(sortByOrderName);

    if (!characters.length) {
      var empty = document.createElement("p");
      empty.className = "admin-empty";
      empty.textContent = "No characters yet.";
      host.appendChild(empty);
    }

    characters.forEach(function (character) {
      var row = document.createElement("label");
      row.className = "character-picker-row";

      var input = document.createElement("input");
      input.type = "checkbox";
      input.value = character.id;
      input.checked = selected.has(character.id);

      if (character.portrait) {
        var image = document.createElement("img");
        image.src = mediaUrl(character.portrait);
        image.alt = "";
        row.appendChild(image);
      } else {
        var placeholder = document.createElement("span");
        placeholder.className = "picker-placeholder";
        placeholder.textContent = String(character.name || "?")
          .slice(0, 1)
          .toUpperCase();
        row.appendChild(placeholder);
      }

      var name = document.createElement("span");
      name.textContent = character.name || "Unnamed";

      row.appendChild(input);
      row.appendChild(name);
      host.appendChild(row);
    });

    $("charactersDialog").showModal();
  }

  function applyCharacters() {
    if (!state.storyDraft) return;

    state.storyDraft.characterIds = Array.from(
      $("characterPickerList").querySelectorAll(
        'input[type="checkbox"]:checked'
      )
    ).map(function (input) {
      return input.value;
    });

    renderStoryCharacterChips();
    markDirty();
    $("charactersDialog").close();
  }

  function openStoryActions() {
    if (!state.storyDraft) return;

    var draft = collectStoryDraft();
    $("storySlugInput").value = draft.slug || slugify(draft.title);
    $("storyOrderInput").value = String(draft.order || 0);
    $("storyActionsDialog").showModal();
  }

  function applyStoryProperties() {
    if (!state.storyDraft) return;

    state.storyDraft.slug = slugify(
      $("storySlugInput").value || $("storyTitleInput").value
    );
    state.storyDraft.order = numberValue($("storyOrderInput").value);
    $("storySlugInput").value = state.storyDraft.slug;
    markDirty();
    $("storyActionsDialog").close();
  }

  function safeUrl(value, image) {
    var url = String(value || "").trim();
    if (!url) return "";

    if (image && /^assets\/thoughts\//i.test(url)) {
      return mediaUrl(url);
    }

    if (/^https?:\/\//i.test(url)) return url;
    if (!image && /^mailto:/i.test(url)) return url;
    if (!image && /^#/.test(url)) return url;
    if (!image && /^(\.\.?\/|\/)/.test(url)) return url;

    return "";
  }

  function inlineMarkdown(source) {
    var tokens = [];
    var text = String(source || "");

    function stash(html) {
      var key = "@@TOKEN" + tokens.length + "@@";
      tokens.push(html);
      return key;
    }

    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (_, alt, url) {
      var clean = safeUrl(url, true);
      if (!clean) return escapeHtml(_);

      var caption = alt
        ? "<figcaption>" + escapeHtml(alt) + "</figcaption>"
        : "";

      return stash(
        '<figure><img src="' +
          escapeHtml(clean) +
          '" alt="' +
          escapeHtml(alt) +
          '" loading="lazy" />' +
          caption +
          "</figure>"
      );
    });

    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, label, url) {
      var clean = safeUrl(url, false);
      if (!clean) return escapeHtml(_);

      var external = /^https?:\/\//i.test(clean);

      return stash(
        '<a href="' +
          escapeHtml(clean) +
          '"' +
          (external ? ' target="_blank" rel="noopener noreferrer"' : "") +
          ">" +
          escapeHtml(label) +
          "</a>"
      );
    });

    text = text.replace(
      new RegExp("\\x60([^\\x60]+)\\x60", "g"),
      function (_, code) {
        return stash("<code>" + escapeHtml(code) + "</code>");
      }
    );

    text = escapeHtml(text)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/(^|[^_])_([^_]+)_/g, "$1<em>$2</em>");

    tokens.forEach(function (html, index) {
      text = text.replace("@@TOKEN" + index + "@@", html);
    });

    return text;
  }

  function markdownToHtml(source) {
    var lines = String(source || "").replace(/\r\n?/g, "\n").split("\n");
    var out = [];
    var paragraph = [];
    var list = null;
    var quote = [];
    var code = [];
    var inCode = false;

    function flushParagraph() {
      if (!paragraph.length) return;
      out.push("<p>" + inlineMarkdown(paragraph.join(" ")) + "</p>");
      paragraph = [];
    }

    function flushList() {
      if (!list) return;
      out.push(
        "<" +
          list.type +
          ">" +
          list.items
            .map(function (item) {
              return "<li>" + inlineMarkdown(item) + "</li>";
            })
            .join("") +
          "</" +
          list.type +
          ">"
      );
      list = null;
    }

    function flushQuote() {
      if (!quote.length) return;
      out.push(
        "<blockquote><p>" +
          inlineMarkdown(quote.join(" ")) +
          "</p></blockquote>"
      );
      quote = [];
    }

    function flushCode() {
      if (!code.length) return;
      out.push("<pre><code>" + escapeHtml(code.join("\n")) + "</code></pre>");
      code = [];
    }

    lines.forEach(function (line) {
      if (
        line.trim().slice(0, 3) ===
        String.fromCharCode(96, 96, 96)
      ) {
        flushParagraph();
        flushList();
        flushQuote();
        if (inCode) flushCode();
        inCode = !inCode;
        return;
      }

      if (inCode) {
        code.push(line);
        return;
      }

      if (!line.trim()) {
        flushParagraph();
        flushList();
        flushQuote();
        return;
      }

      var heading = line.match(/^(#{2,3})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        flushList();
        flushQuote();
        var level = heading[1].length;
        out.push(
          "<h" +
            level +
            ">" +
            inlineMarkdown(heading[2]) +
            "</h" +
            level +
            ">"
        );
        return;
      }

      var quoted = line.match(/^>\s?(.*)$/);
      if (quoted) {
        flushParagraph();
        flushList();
        quote.push(quoted[1]);
        return;
      }

      var unordered = line.match(/^[-*]\s+(.+)$/);
      if (unordered) {
        flushParagraph();
        flushQuote();
        if (!list || list.type !== "ul") {
          flushList();
          list = { type: "ul", items: [] };
        }
        list.items.push(unordered[1]);
        return;
      }

      var ordered = line.match(/^\d+\.\s+(.+)$/);
      if (ordered) {
        flushParagraph();
        flushQuote();
        if (!list || list.type !== "ol") {
          flushList();
          list = { type: "ol", items: [] };
        }
        list.items.push(ordered[1]);
        return;
      }

      flushList();
      flushQuote();
      paragraph.push(line.trim());
    });

    flushParagraph();
    flushList();
    flushQuote();
    if (inCode || code.length) flushCode();

    return out.join("\n");
  }

  function setEditorMode(mode) {
    var preview = mode === "preview";

    $("storyBodyInput").hidden = preview;
    $("writerToolbar").hidden = preview;
    $("storyPreview").hidden = !preview;
    $("writeModeBtn").classList.toggle("active", !preview);
    $("previewModeBtn").classList.toggle("active", preview);

    if (preview) {
      $("storyPreview").innerHTML = markdownToHtml(
        $("storyBodyInput").value
      );
    }
  }

  function selectedLineRange(textarea) {
    var value = textarea.value;
    var start = textarea.selectionStart || 0;
    var end = textarea.selectionEnd || 0;
    var lineStart = value.lastIndexOf("\n", start - 1) + 1;
    var lineEnd = value.indexOf("\n", end);
    if (lineEnd < 0) lineEnd = value.length;

    return {
      start: lineStart,
      end: lineEnd,
      text: value.slice(lineStart, lineEnd),
    };
  }

  function replaceSelection(textarea, replacement, selectStart, selectEnd) {
    var start = textarea.selectionStart || 0;
    var end = textarea.selectionEnd || 0;

    textarea.value =
      textarea.value.slice(0, start) +
      replacement +
      textarea.value.slice(end);

    textarea.selectionStart =
      start + (selectStart == null ? replacement.length : selectStart);
    textarea.selectionEnd =
      start + (selectEnd == null ? replacement.length : selectEnd);
    textarea.focus();
    markDirty();
  }

  function applyFormat(format) {
    var textarea = $("storyBodyInput");
    var start = textarea.selectionStart || 0;
    var end = textarea.selectionEnd || 0;
    var selected = textarea.value.slice(start, end);

    if (format === "bold") {
      replaceSelection(
        textarea,
        "**" + (selected || "text") + "**",
        2,
        2 + (selected || "text").length
      );
      return;
    }

    if (format === "italic") {
      replaceSelection(
        textarea,
        "*" + (selected || "text") + "*",
        1,
        1 + (selected || "text").length
      );
      return;
    }

    var range = selectedLineRange(textarea);
    var prefix =
      format === "h2"
        ? "## "
        : format === "h3"
          ? "### "
          : format === "quote"
            ? "> "
            : "- ";

    var replacement = range.text
      .split("\n")
      .map(function (line) {
        return prefix + line;
      })
      .join("\n");

    textarea.value =
      textarea.value.slice(0, range.start) +
      replacement +
      textarea.value.slice(range.end);

    textarea.selectionStart = range.start;
    textarea.selectionEnd = range.start + replacement.length;
    textarea.focus();
    markDirty();
  }

  function insertAtCursor(textarea, text) {
    var start = textarea.selectionStart || 0;
    var end = textarea.selectionEnd || 0;

    textarea.value =
      textarea.value.slice(0, start) +
      text +
      textarea.value.slice(end);

    textarea.selectionStart = textarea.selectionEnd =
      start + text.length;
    textarea.focus();
    markDirty();
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      var objectUrl = URL.createObjectURL(file);

      image.onload = function () {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };

      image.onerror = function () {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Could not read that image."));
      };

      image.src = objectUrl;
    });
  }

  function compressImage(file) {
    return loadImage(file).then(function (image) {
      var width = image.naturalWidth;
      var height = image.naturalHeight;
      var maxWidth = 1400;

      if (width > maxWidth) {
        height = Math.round(height * (maxWidth / width));
        width = maxWidth;
      }

      var canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(image, 0, 0, width, height);

      return new Promise(function (resolve) {
        canvas.toBlob(
          function (blob) {
            if (blob) {
              resolve({ blob: blob, ext: "webp" });
              return;
            }

            canvas.toBlob(
              function (jpg) {
                resolve({ blob: jpg, ext: "jpg" });
              },
              "image/jpeg",
              0.8
            );
          },
          "image/webp",
          0.78
        );
      });
    });
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();

      reader.onload = function () {
        resolve(String(reader.result).split(",")[1]);
      };

      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function uploadFile(file) {
    return compressImage(file).then(function (result) {
      if (!result.blob) {
        throw new Error("Could not compress the image.");
      }

      return blobToBase64(result.blob).then(function (content) {
        return apiJson(API.upload, {
          method: "POST",
          body: JSON.stringify({
            filename: file.name.replace(/\.[^.]+$/, ""),
            extension: result.ext,
            content: content,
          }),
        });
      });
    });
  }

  function uploadPortrait() {
    var input = $("portraitFileInput");
    var file = input.files && input.files[0];

    if (!file) return;

    var previousPath = $("portraitPathInput").value || "";
    var previewUrl = URL.createObjectURL(file);
    var preview = $("portraitPreview");

    preview.src = previewUrl;
    preview.hidden = false;
    $("portraitPlaceholder").hidden = true;

    preview.onload = function () {
      URL.revokeObjectURL(previewUrl);
      preview.onload = null;
    };

    $("saveEntityBtn").disabled = true;
    $("entityStatus").textContent = "Uploading portrait…";

    uploadFile(file)
      .then(function (result) {
        setPortraitPreview(result.path);
        input.value = "";
        $("entityStatus").textContent =
          "Portrait ready. Save the Character to keep it.";
      })
      .catch(function (error) {
        input.value = "";
        setPortraitPreview(previousPath);
        if (handleAuthError(error)) return;
        $("entityStatus").textContent =
          "Portrait upload failed: " + error.message;
      })
      .finally(function () {
        $("saveEntityBtn").disabled = false;
      });
  }

  function renderStoryHeaderImage() {
    var draft = state.storyDraft || {};
    var path = String(draft.headerImage || "");
    var position = Math.max(
      0,
      Math.min(100, Number(draft.headerImagePosition == null ? 50 : draft.headerImagePosition))
    );
    var add = $("addStoryHeaderBtn");
    var preview = $("storyHeaderPreview");
    var image = $("storyHeaderPreviewImage");
    var slider = $("storyHeaderPositionInput");
    var positionPanel = $("storyHeaderPosition");

    if (!path) {
      add.hidden = false;
      preview.hidden = true;
      positionPanel.hidden = true;
      image.removeAttribute("src");
      return;
    }

    add.hidden = true;
    preview.hidden = false;
    image.src = mediaUrl(path);
    image.style.objectPosition = "50% " + position + "%";
    slider.value = String(position);
  }

  function chooseStoryHeaderImage() {
    $("storyHeaderImageInput").click();
  }

  function uploadStoryHeaderImage() {
    var input = $("storyHeaderImageInput");
    var file = input.files && input.files[0];
    if (!file || !state.storyDraft) return;

    setSaveIndicator("Uploading header…", "saving");
    $("addStoryHeaderBtn").disabled = true;
    $("replaceStoryHeaderBtn").disabled = true;

    uploadFile(file)
      .then(function (result) {
        state.storyDraft.headerImage = result.path;
        if (state.storyDraft.headerImagePosition == null) {
          state.storyDraft.headerImagePosition = 50;
        }
        input.value = "";
        renderStoryHeaderImage();
        markDirty();
        toast("Header image ready. Save the story to keep it.");
      })
      .catch(function (error) {
        input.value = "";
        if (handleAuthError(error)) return;
        setSaveIndicator("Upload failed", "error");
        toast(error.message, true);
      })
      .finally(function () {
        $("addStoryHeaderBtn").disabled = false;
        $("replaceStoryHeaderBtn").disabled = false;
      });
  }

  function removeStoryHeaderImage() {
    if (!state.storyDraft || !state.storyDraft.headerImage) return;

    state.storyDraft.headerImage = "";
    state.storyDraft.headerImagePosition = 50;
    $("storyHeaderPosition").hidden = true;
    renderStoryHeaderImage();
    markDirty();
  }

  function toggleStoryHeaderPosition() {
    if (!state.storyDraft || !state.storyDraft.headerImage) return;

    var panel = $("storyHeaderPosition");
    panel.hidden = !panel.hidden;

    if (!panel.hidden) {
      $("storyHeaderPositionInput").focus();
    }
  }

  function updateStoryHeaderPosition() {
    if (!state.storyDraft || !state.storyDraft.headerImage) return;

    var value = Math.max(
      0,
      Math.min(100, Number($("storyHeaderPositionInput").value || 50))
    );

    state.storyDraft.headerImagePosition = value;
    $("storyHeaderPreviewImage").style.objectPosition = "50% " + value + "%";
    markDirty();
  }

  function uploadStoryImage() {
    var file =
      $("storyImageInput").files &&
      $("storyImageInput").files[0];

    if (!file) return;

    setSaveIndicator("Uploading image…", "saving");

    uploadFile(file)
      .then(function (result) {
        insertAtCursor(
          $("storyBodyInput"),
          "\n\n![Image](" + result.path + ")\n\n"
        );
        $("storyImageInput").value = "";
        setSaveIndicator("Unsaved");
      })
      .catch(function (error) {
        if (handleAuthError(error)) return;
        setSaveIndicator("Upload failed", "error");
        toast(error.message, true);
      });
  }

  function wire() {
    localStorage.removeItem("thoughts_gh_token");
    sessionStorage.removeItem("thoughts_gh_token");

    initTheme();

    $("homeButton").addEventListener("click", function () {
      showLibraryView(false);
    });
    $("backToLibraryBtn").addEventListener("click", function () {
      showLibraryView(false);
    });

    $("addSeriesBtn").addEventListener("click", function () {
      openEntity("series", "");
    });
    $("emptyAddSeriesBtn").addEventListener("click", function () {
      openEntity("series", "");
    });
    $("addCharacterBtn").addEventListener("click", function () {
      openEntity("character", "");
    });

    $("entityNameInput").addEventListener("input", function () {
      if (!state.entitySlugTouched && state.entityType !== "character") {
        $("entitySlugInput").value = slugify(this.value);
      }
    });
    $("entitySlugInput").addEventListener("input", function () {
      state.entitySlugTouched = Boolean(this.value.trim());
      this.value = slugify(this.value);
    });
    $("entitySeriesInput").addEventListener("change", function () {
      if (state.entityType === "character") {
        fillSubseriesSelect(
          $("entitySubseriesInput"),
          this.value,
          "",
          "No sub-series"
        );
      }
    });

    $("saveEntityBtn").addEventListener("click", saveEntity);
    $("deleteEntityBtn").addEventListener("click", deleteEntity);
    $("seriesCoverFileInput").addEventListener("change", uploadSeriesCover);
    $("clearSeriesCoverBtn").addEventListener("click", function () {
      setSeriesCoverPreview("");
      $("entityStatus").textContent =
        "Book cover removed. Save the Series to keep the change.";
    });

    $("portraitFileInput").addEventListener("change", uploadPortrait);
    $("clearPortraitBtn").addEventListener("click", function () {
      setPortraitPreview("");
      $("entityStatus").textContent =
        "Portrait cleared. Save to keep the change.";
    });

    $("storySeriesInput").addEventListener("change", function () {
      if (!state.storyDraft) return;

      fillSubseriesSelect(
        $("storySubseriesInput"),
        this.value,
        "",
        "No sub-series"
      );
      markDirty();
    });

    [
      "storyTitleInput",
      "storyBodyInput",
      "storyDateInput",
      "storySubseriesInput",
      "storyPublishedInput",
    ].forEach(function (id) {
      $(id).addEventListener("input", markDirty);
      $(id).addEventListener("change", markDirty);
    });

    $("saveStoryBtn").addEventListener("click", saveStory);
    $("writeModeBtn").addEventListener("click", function () {
      setEditorMode("write");
    });
    $("previewModeBtn").addEventListener("click", function () {
      setEditorMode("preview");
    });

    $("writerToolbar").addEventListener("click", function (event) {
      var button = event.target.closest("[data-format]");
      if (!button) return;
      applyFormat(button.getAttribute("data-format"));
    });

    $("addStoryHeaderBtn").addEventListener("click", chooseStoryHeaderImage);
    $("replaceStoryHeaderBtn").addEventListener("click", chooseStoryHeaderImage);
    $("repositionStoryHeaderBtn").addEventListener("click", toggleStoryHeaderPosition);
    $("removeStoryHeaderBtn").addEventListener("click", removeStoryHeaderImage);
    $("storyHeaderImageInput").addEventListener("change", uploadStoryHeaderImage);
    $("storyHeaderPositionInput").addEventListener("input", updateStoryHeaderPosition);

    $("insertImageBtn").addEventListener("click", function () {
      $("storyImageInput").click();
    });
    $("storyImageInput").addEventListener("change", uploadStoryImage);

    $("chooseCharactersBtn").addEventListener("click", openCharactersDialog);
    $("closeCharactersDialogBtn").addEventListener("click", function () {
      $("charactersDialog").close();
    });
    $("applyCharactersBtn").addEventListener("click", applyCharacters);

    $("storyMoreBtn").addEventListener("click", openStoryActions);
    $("storyPropertiesBtn").addEventListener("click", openStoryActions);
    $("closeStoryActionsBtn").addEventListener("click", function () {
      $("storyActionsDialog").close();
    });
    $("closeStoryActionsDoneBtn").addEventListener(
      "click",
      applyStoryProperties
    );
    $("deleteStoryBtn").addEventListener("click", deleteStory);

    window.addEventListener("beforeunload", function (event) {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = "";
    });

    $("adminApp").hidden = false;
    loadData()
      .then(function () {
        showLibraryView(true);
      })
      .catch(function (error) {
        setSaveIndicator("Load failed", "error");
        toast("Could not load the library: " + error.message, true);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
