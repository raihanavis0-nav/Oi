(function () {
  "use strict";

  var API = {
    content: "/api/thoughts-admin/content",
    upload: "/api/thoughts-admin/audio-upload",
    media: "/api/thoughts-admin/media",
  };

  var MAX_AUDIO_BYTES = 10 * 1024 * 1024;
  var DIRECT_AUDIO_BYTES = 3 * 1024 * 1024;
  var CHUNK_BYTES = 2 * 1024 * 1024;

  var cache = { data: null, revision: "" };
  var currentTarget = { type: "", id: "" };
  var uploadedPath = "";
  var observer = null;

  function ensureStyles() {
    if (document.querySelector('link[href="css/thoughts-ending-song.css"]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "css/thoughts-ending-song.css";
    document.head.appendChild(link);
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
            throw error;
          }
          return body;
        });
    });
  }

  function sortByOrderName(a, b) {
    var order = Number(a.order || 0) - Number(b.order || 0);
    if (order) return order;
    return String(a.name || "").localeCompare(String(b.name || ""));
  }

  function sortStories(a, b) {
    var order = Number(a.order || 0) - Number(b.order || 0);
    if (order) return order;

    var date = String(a.date || "").localeCompare(String(b.date || ""));
    if (date) return date;

    return String(a.title || "").localeCompare(String(b.title || ""));
  }

  function nodeBySortId(nodes, id, fallbackIndex) {
    var wanted = String(id || "");
    var exact = nodes.find(function (node) {
      return String(node.getAttribute("data-sort-id") || "") === wanted;
    });
    if (exact) return exact;

    var fallback = nodes[fallbackIndex];
    if (!fallback || fallback.getAttribute("data-sort-id")) return null;
    return fallback;
  }

  function toast(message, error) {
    var node = document.getElementById("adminToast");
    if (!node) return;

    node.textContent = message;
    node.style.color = error ? "var(--admin-danger)" : "";
    node.hidden = false;

    window.setTimeout(function () {
      node.hidden = true;
    }, 3000);
  }

  function mediaUrl(path) {
    return API.media + "?path=" + encodeURIComponent(String(path || ""));
  }

  function loadContent() {
    return apiJson(API.content).then(function (result) {
      cache.data =
        result.data || { series: [], subseries: [], characters: [], stories: [] };
      cache.revision = String(result.revision || "");
      return cache.data;
    });
  }

  function targetItem() {
    if (!cache.data) return null;

    var list =
      currentTarget.type === "story"
        ? cache.data.stories || []
        : cache.data.subseries || [];

    return (
      list.find(function (item) {
        return item && item.id === currentTarget.id;
      }) || null
    );
  }

  function dialog() {
    var existing = document.getElementById("endingSongDialog");
    if (existing) return existing;

    var node = document.createElement("dialog");
    node.className = "editor-dialog small-dialog";
    node.id = "endingSongDialog";
    node.innerHTML =
      '<div class="dialog-shell">' +
      '<div class="dialog-head">' +
      '<div><p class="eyebrow" id="endingSongScope">Story</p><h2 id="endingSongDialogTitle">Ending song</h2></div>' +
      '<button class="icon-action" id="endingSongClose" type="button" aria-label="Close">×</button>' +
      "</div>" +
      '<div class="ending-song-admin">' +
      '<div class="ending-song-admin-grid">' +
      '<div class="dialog-field"><label for="endingSongAdminTitle">Song title</label><input id="endingSongAdminTitle" type="text" autocomplete="off"></div>' +
      '<div class="dialog-field"><label for="endingSongAdminArtist">Artist</label><input id="endingSongAdminArtist" type="text" autocomplete="off"></div>' +
      "</div>" +
      '<div class="dialog-field">' +
      '<label for="endingSongAdminFile">Audio</label>' +
      '<div class="ending-song-file-row"><input id="endingSongAdminFile" type="file" accept=".mp3,.m4a,.ogg,audio/mpeg,audio/mp4,audio/ogg"><button class="quiet-action" id="endingSongClear" type="button">Remove</button></div>' +
      '<p class="ending-song-help">MP3, M4A, or OGG. Up to 10 MB. Large files upload in smaller chunks automatically.</p>' +
      "</div>" +
      '<audio id="endingSongAdminPreview" controls preload="metadata" hidden></audio>' +
      "</div>" +
      '<div class="dialog-foot">' +
      '<span class="dialog-spacer"></span>' +
      '<button class="quiet-action" id="endingSongCancel" type="button">Cancel</button>' +
      '<button class="primary-action" id="endingSongSave" type="button">Save</button>' +
      "</div>" +
      '<p class="dialog-status" id="endingSongStatus" role="status"></p>' +
      "</div>";

    document.body.appendChild(node);

    document.getElementById("endingSongClose").addEventListener("click", function () {
      node.close();
    });
    document.getElementById("endingSongCancel").addEventListener("click", function () {
      node.close();
    });
    document.getElementById("endingSongClear").addEventListener("click", function () {
      uploadedPath = "";
      document.getElementById("endingSongAdminTitle").value = "";
      document.getElementById("endingSongAdminArtist").value = "";
      setPreview("");
      document.getElementById("endingSongStatus").textContent =
        currentTarget.type === "story"
          ? "Story song removed. Save to use the Chapter fallback when applicable."
          : "Chapter song removed. Save to keep the change.";
    });
    document
      .getElementById("endingSongAdminFile")
      .addEventListener("change", uploadSelectedAudio);
    document.getElementById("endingSongSave").addEventListener("click", saveSong);

    return node;
  }

  function setPreview(path) {
    var preview = document.getElementById("endingSongAdminPreview");
    if (!path) {
      preview.pause();
      preview.hidden = true;
      preview.removeAttribute("src");
      return;
    }

    preview.src = mediaUrl(path);
    preview.hidden = false;
    preview.load();
  }

  function storyFallbackHint(story) {
    if (!story || !story.subseriesId || !cache.data) return "";

    var subseries = (cache.data.subseries || []).find(function (item) {
      return item && item.id === story.subseriesId;
    });

    if (!subseries || !subseries.endingSong || !subseries.endingSong.path) {
      return "";
    }

    return "No Story song set. The Chapter song remains available as the final-story fallback.";
  }

  function openSongEditor(type, id) {
    currentTarget = { type: type, id: id };
    uploadedPath = "";

    var node = dialog();
    var status = document.getElementById("endingSongStatus");
    status.textContent = "Loading…";

    loadContent()
      .then(function () {
        var item = targetItem();
        if (!item) {
          throw new Error(type === "story" ? "Story not found." : "Sub-series not found.");
        }

        document.getElementById("endingSongScope").textContent =
          type === "story" ? "Story" : "Chapter / Sub-series";
        document.getElementById("endingSongDialogTitle").textContent =
          (item.title || item.name || "Ending song") + " · Song";

        var song = item.endingSong || {};
        uploadedPath = song.path || "";
        document.getElementById("endingSongAdminTitle").value = song.title || "";
        document.getElementById("endingSongAdminArtist").value = song.artist || "";
        document.getElementById("endingSongAdminFile").value = "";
        setPreview(uploadedPath);
        status.textContent =
          type === "story" && !uploadedPath ? storyFallbackHint(item) : "";
      })
      .catch(function (error) {
        status.textContent = error.message;
      });

    node.showModal();
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

  function makeUploadId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID().replace(/[^a-zA-Z0-9-]/g, "").toLowerCase();
    }

    return (
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2) +
      Math.random().toString(36).slice(2)
    ).slice(0, 70);
  }

  function uploadDirect(file, extension) {
    return blobToBase64(file).then(function (content) {
      return apiJson(API.upload, {
        method: "POST",
        body: JSON.stringify({
          filename: file.name.replace(/\.[^.]+$/, ""),
          extension: extension,
          content: content,
        }),
      });
    });
  }

  function uploadChunked(file, extension, status) {
    var uploadId = makeUploadId();
    var totalChunks = Math.ceil(file.size / CHUNK_BYTES);
    var chain = Promise.resolve();

    Array.from({ length: totalChunks }).forEach(function (_, index) {
      chain = chain.then(function () {
        status.textContent =
          "Uploading audio… " + (index + 1) + "/" + totalChunks;

        var start = index * CHUNK_BYTES;
        var end = Math.min(start + CHUNK_BYTES, file.size);
        return blobToBase64(file.slice(start, end)).then(function (content) {
          return apiJson(API.upload, {
            method: "POST",
            body: JSON.stringify({
              mode: "chunk",
              uploadId: uploadId,
              index: index,
              totalChunks: totalChunks,
              extension: extension,
              content: content,
            }),
          });
        });
      });
    });

    return chain.then(function () {
      status.textContent = "Finalizing audio…";
      return apiJson(API.upload, {
        method: "POST",
        body: JSON.stringify({
          mode: "finalize",
          uploadId: uploadId,
          totalChunks: totalChunks,
          totalSize: file.size,
          filename: file.name.replace(/\.[^.]+$/, ""),
          extension: extension,
        }),
      });
    });
  }

  function uploadSelectedAudio() {
    var input = document.getElementById("endingSongAdminFile");
    var file = input.files && input.files[0];
    var status = document.getElementById("endingSongStatus");
    var save = document.getElementById("endingSongSave");
    if (!file) return;

    var extension = String(file.name.split(".").pop() || "").toLowerCase();
    if (!["mp3", "m4a", "ogg"].includes(extension)) {
      input.value = "";
      status.textContent = "Use MP3, M4A, or OGG.";
      return;
    }

    if (file.size > MAX_AUDIO_BYTES) {
      input.value = "";
      status.textContent = "Audio is too large. Use a file 10 MB or smaller.";
      return;
    }

    save.disabled = true;
    status.textContent = "Uploading audio…";

    var upload =
      file.size <= DIRECT_AUDIO_BYTES
        ? uploadDirect(file, extension)
        : uploadChunked(file, extension, status);

    upload
      .then(function (result) {
        uploadedPath = result.path || "";
        setPreview(uploadedPath);
        status.textContent = "Audio ready. Save to attach it.";
      })
      .catch(function (error) {
        status.textContent = "Upload failed: " + error.message;
      })
      .finally(function () {
        save.disabled = false;
        input.value = "";
      });
  }

  function saveSong() {
    var save = document.getElementById("endingSongSave");
    var status = document.getElementById("endingSongStatus");
    save.disabled = true;
    status.textContent = "Saving…";

    loadContent()
      .then(function () {
        var data = JSON.parse(JSON.stringify(cache.data));
        var list =
          currentTarget.type === "story" ? data.stories || [] : data.subseries || [];
        var item = list.find(function (entry) {
          return entry && entry.id === currentTarget.id;
        });

        if (!item) {
          throw new Error(
            currentTarget.type === "story" ? "Story not found." : "Sub-series not found."
          );
        }

        var title = document.getElementById("endingSongAdminTitle").value.trim();
        var artist = document.getElementById("endingSongAdminArtist").value.trim();

        if (uploadedPath) {
          item.endingSong = {
            title: title,
            artist: artist,
            path: uploadedPath,
          };
        } else {
          delete item.endingSong;
        }

        return apiJson(API.content, {
          method: "PUT",
          body: JSON.stringify({
            data: data,
            revision: cache.revision,
            message:
              'stories: update ending song ' +
              currentTarget.type +
              ' "' +
              (item.title || item.name || "Untitled") +
              '"',
          }),
        });
      })
      .then(function () {
        dialog().close();
        toast(
          currentTarget.type === "story" ? "Story song saved." : "Chapter song saved."
        );
        return loadContent();
      })
      .then(decorateAll)
      .catch(function (error) {
        status.textContent = error.message;
      })
      .finally(function () {
        save.disabled = false;
      });
  }

  function addSongButton(tools, className, label, type, id) {
    if (!tools || tools.querySelector("." + className)) return;

    var button = document.createElement("button");
    button.type = "button";
    button.className = className + " ending-song-tool";
    button.textContent = label;
    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      openSongEditor(type, id);
    });
    tools.insertBefore(button, tools.firstChild);
  }

  function decorateStoriesInList(list, stories) {
    if (!list) return;

    var rows = Array.from(list.querySelectorAll(":scope > .admin-story-row"));
    stories
      .slice()
      .sort(sortStories)
      .forEach(function (story, index) {
        var row = nodeBySortId(rows, story.id, index);
        if (!row) return;

        var tools = row.querySelector(".admin-row-tools");
        addSongButton(
          tools,
          "story-ending-song-tool",
          story.endingSong && story.endingSong.path ? "♪ Story" : "+ Song",
          "story",
          story.id
        );
      });
  }

  function decorateAll() {
    var host = document.getElementById("adminSeriesList");
    if (!host || !cache.data) return;

    var seriesItems = (cache.data.series || []).slice().sort(sortByOrderName);
    var seriesBlocks = Array.from(host.querySelectorAll(".admin-series-block"));

    seriesItems.forEach(function (series, seriesIndex) {
      var block = nodeBySortId(seriesBlocks, series.id, seriesIndex);
      if (!block) return;

      var directStories = (cache.data.stories || []).filter(function (story) {
        return story.seriesId === series.id && !story.subseriesId;
      });
      var directList = Array.from(block.children).find(function (child) {
        return child.classList && child.classList.contains("story-list");
      });
      decorateStoriesInList(directList, directStories);

      var subseriesItems = (cache.data.subseries || [])
        .filter(function (item) {
          return item.seriesId === series.id;
        })
        .sort(sortByOrderName);
      var subseriesBlocks = Array.from(
        block.querySelectorAll(":scope > .subseries-block")
      );

      subseriesItems.forEach(function (subseries, subIndex) {
        var subBlock = nodeBySortId(subseriesBlocks, subseries.id, subIndex);
        if (!subBlock) return;

        var tools = subBlock.querySelector(
          ".admin-subseries-title-row .admin-row-tools"
        );
        addSongButton(
          tools,
          "chapter-ending-song-tool",
          subseries.endingSong && subseries.endingSong.path
            ? "♪ Chapter"
            : "+ Chapter song",
          "subseries",
          subseries.id
        );

        var nestedStories = (cache.data.stories || []).filter(function (story) {
          return story.subseriesId === subseries.id;
        });
        var nestedList = Array.from(subBlock.children).find(function (child) {
          return child.classList && child.classList.contains("story-list");
        });
        decorateStoriesInList(nestedList, nestedStories);
      });
    });
  }

  function scheduleDecorate() {
    window.clearTimeout(scheduleDecorate.timer);
    scheduleDecorate.timer = window.setTimeout(function () {
      loadContent().then(decorateAll).catch(function () {});
    }, 80);
  }

  function init() {
    var host = document.getElementById("adminSeriesList");
    if (!host) return;

    ensureStyles();
    observer = new MutationObserver(scheduleDecorate);
    observer.observe(host, { childList: true, subtree: true });
    scheduleDecorate();
  }

  window.ThoughtsEndingSongAdmin = {
    openSongEditor: openSongEditor,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
