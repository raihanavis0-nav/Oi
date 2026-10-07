(function () {
  "use strict";

  var originalFetch = window.fetch.bind(window);
  var localChain = null;
  var uiSnapshotData = null;
  var snapshot = {
    revision: "",
    data: null,
  };

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function requestUrl(input) {
    if (typeof input === "string") return input;
    if (input && typeof input.url === "string") return input.url;
    return "";
  }

  function isContentEndpoint(url) {
    try {
      var parsed = new URL(url, window.location.href);
      return (
        parsed.origin === window.location.origin &&
        parsed.pathname === "/api/thoughts-admin/content"
      );
    } catch (_) {
      return false;
    }
  }

  function parseBody(init) {
    if (!init || typeof init.body !== "string") return null;
    try {
      return JSON.parse(init.body);
    } catch (_) {
      return null;
    }
  }

  function rememberSnapshot(revision, data) {
    if (revision) snapshot.revision = String(revision);
    if (data) snapshot.data = clone(data);
  }

  function byId(items) {
    return new Map(
      (Array.isArray(items) ? items : []).map(function (item) {
        return [item && item.id, item];
      })
    );
  }

  function copyEndingSongs(targetData, sourceData) {
    if (!targetData || !sourceData) return;

    ["stories", "subseries"].forEach(function (key) {
      var target = Array.isArray(targetData[key]) ? targetData[key] : [];
      var source = byId(sourceData[key]);

      target.forEach(function (item) {
        if (!item || !source.has(item.id)) return;
        var latest = source.get(item.id);

        if (Object.prototype.hasOwnProperty.call(latest, "endingSong")) {
          item.endingSong = clone(latest.endingSong);
        } else {
          delete item.endingSong;
        }
      });
    });
  }

  function sameScope(kind, a, b) {
    if (!a || !b) return false;
    if (kind === "subseries") return a.seriesId === b.seriesId;
    if (kind === "characters") {
      return String(a.seriesId || "") === String(b.seriesId || "");
    }
    if (kind === "stories") {
      return (
        String(a.seriesId || "") === String(b.seriesId || "") &&
        String(a.subseriesId || "") === String(b.subseriesId || "")
      );
    }
    return true;
  }

  function normalizeCollection(targetItems, baseItems, kind) {
    var target = Array.isArray(targetItems) ? targetItems : [];
    var base = byId(baseItems);
    var groups = new Map();

    function scopeKey(item) {
      if (kind === "subseries") return String(item.seriesId || "");
      if (kind === "characters") return String(item.seriesId || "");
      if (kind === "stories") {
        return String(item.seriesId || "") + "\u0000" + String(item.subseriesId || "");
      }
      return "all";
    }

    target.forEach(function (item, index) {
      if (!item) return;
      var previous = base.get(item.id);
      var key = scopeKey(item);
      if (!groups.has(key)) groups.set(key, []);

      var stableOrder = Number(item.order || 0);
      if (previous && sameScope(kind, item, previous)) {
        stableOrder = Number(previous.order || stableOrder || 0);
      } else {
        stableOrder = Number.MAX_SAFE_INTEGER - 100000 + index;
      }

      groups.get(key).push({
        item: item,
        order: stableOrder,
        index: index,
      });
    });

    groups.forEach(function (entries) {
      entries
        .sort(function (a, b) {
          if (a.order !== b.order) return a.order - b.order;
          return a.index - b.index;
        })
        .forEach(function (entry, index) {
          entry.item.order = index + 1;
        });
    });
  }

  function applyAutomaticOrders(targetData, baseData) {
    if (!targetData || !baseData) return;

    normalizeCollection(targetData.series, baseData.series, "series");
    normalizeCollection(targetData.subseries, baseData.subseries, "subseries");
    normalizeCollection(targetData.characters, baseData.characters, "characters");
    normalizeCollection(targetData.stories, baseData.stories, "stories");
  }

  function copyOrderFields(targetData, sourceData) {
    if (!targetData || !sourceData) return;

    ["series", "subseries", "characters", "stories"].forEach(function (key) {
      var source = byId(sourceData[key]);
      (Array.isArray(targetData[key]) ? targetData[key] : []).forEach(function (item) {
        if (!item || !source.has(item.id)) return;
        var latest = source.get(item.id);
        if (typeof latest.order === "number") item.order = latest.order;
      });
    });
  }

  function isLocalToolSave(payload) {
    var message = String((payload && payload.message) || "");
    return (
      message.startsWith("stories: update ending song") ||
      message.startsWith("stories: reorder ")
    );
  }

  function mergeManagedFields(targetData, sourceData) {
    copyEndingSongs(targetData, sourceData);
    copyOrderFields(targetData, sourceData);
  }

  window.ThoughtsContentSync = {
    getSnapshot: function () {
      return {
        revision: snapshot.revision,
        data: clone(snapshot.data),
      };
    },
    getUiData: function () {
      return clone(uiSnapshotData || snapshot.data);
    },
  };

  window.fetch = function (input, init) {
    var url = requestUrl(input);
    var method = String((init && init.method) || "GET").toUpperCase();

    if (!isContentEndpoint(url)) {
      return originalFetch(input, init);
    }

    if (method === "GET") {
      return originalFetch(input, init).then(function (response) {
        if (!response.ok) return response;

        return response
          .clone()
          .json()
          .catch(function () {
            return {};
          })
          .then(function (result) {
            rememberSnapshot(result.revision, result.data);
            uiSnapshotData = clone(result.data);
            return response;
          });
      });
    }

    if (method !== "PUT") {
      return originalFetch(input, init);
    }

    var payload = parseBody(init);
    if (!payload || !payload.data) {
      return originalFetch(input, init);
    }

    var localSave = isLocalToolSave(payload);
    var originalUiData = localSave ? null : clone(payload.data);
    var transformed = false;
    var nextPayload = clone(payload);

    if (!localSave) {
      if (snapshot.data) {
        mergeManagedFields(nextPayload.data, snapshot.data);
        applyAutomaticOrders(nextPayload.data, snapshot.data);
        transformed = true;
      }

      if (localChain) {
        if (nextPayload.revision === localChain.rootRevision) {
          nextPayload.revision = localChain.latestRevision;
          mergeManagedFields(nextPayload.data, localChain.data);
          applyAutomaticOrders(nextPayload.data, localChain.data);
          transformed = true;
        } else if (nextPayload.revision === localChain.latestRevision) {
          mergeManagedFields(nextPayload.data, localChain.data);
          applyAutomaticOrders(nextPayload.data, localChain.data);
          transformed = true;
        }
      }
    }

    var requestInit = transformed
      ? Object.assign({}, init, { body: JSON.stringify(nextPayload) })
      : init;
    var sentPayload = transformed ? nextPayload : payload;
    var localBaseRevision = localSave ? String(payload.revision || "") : "";
    var localData = localSave ? clone(payload.data) : null;

    return originalFetch(input, requestInit).then(function (response) {
      if (!response.ok) return response;

      return response
        .clone()
        .json()
        .catch(function () {
          return {};
        })
        .then(function (result) {
          var revision = String(result.revision || "");
          rememberSnapshot(revision, sentPayload.data);

          if (!localSave && originalUiData) {
            uiSnapshotData = originalUiData;
          }

          if (localSave && revision) {
            if (localChain && localChain.latestRevision === localBaseRevision) {
              localChain.latestRevision = revision;
              localChain.data = clone(localData);
            } else {
              localChain = {
                rootRevision: localBaseRevision,
                latestRevision: revision,
                data: clone(localData),
              };
            }
          } else if (
            localChain &&
            (transformed || sentPayload.revision === localChain.latestRevision)
          ) {
            localChain = null;
          }

          return response;
        });
    });
  };
})();
