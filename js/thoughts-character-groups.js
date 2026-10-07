(function () {
  "use strict";

  var GRID_IDS = ["characterGrid", "adminCharacterGrid"];
  var scheduled = new WeakSet();

  function seriesOrder() {
    return Array.from(document.querySelectorAll(".series-title"))
      .map(function (node) {
        return node.textContent.trim();
      })
      .filter(Boolean);
  }

  function cardGroup(card) {
    var meta = card.querySelector(".character-meta");
    var raw = meta ? meta.textContent.trim() : "";
    var parts = raw
      .split("/")
      .map(function (part) {
        return part.trim();
      })
      .filter(Boolean);

    return {
      name: parts[0] || "Global / Unassigned",
      detail: parts.slice(1).join(" / "),
      meta: meta,
    };
  }

  function groupGrid(grid) {
    var cards = Array.from(grid.querySelectorAll(":scope > .character-card"));
    if (!cards.length) return;

    var groups = new Map();

    cards.forEach(function (card) {
      var info = cardGroup(card);
      if (!groups.has(info.name)) groups.set(info.name, []);
      groups.get(info.name).push({ card: card, info: info });
    });

    var order = seriesOrder();
    var names = Array.from(groups.keys()).sort(function (a, b) {
      if (a === "Global / Unassigned") return 1;
      if (b === "Global / Unassigned") return -1;

      var ai = order.indexOf(a);
      var bi = order.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

    names.forEach(function (name) {
      var group = document.createElement("section");
      group.className = "character-series-group";
      group.setAttribute("data-character-series", name);

      var heading = document.createElement("h3");
      heading.className = "character-series-heading";
      heading.textContent = name;
      group.appendChild(heading);

      groups.get(name).forEach(function (entry) {
        if (entry.info.meta) {
          if (entry.info.detail) {
            entry.info.meta.textContent = entry.info.detail;
            entry.info.meta.hidden = false;
          } else {
            entry.info.meta.hidden = true;
          }
        }

        entry.card.setAttribute("data-character-series", name);
        group.appendChild(entry.card);
      });

      grid.appendChild(group);
    });
  }

  function schedule(grid) {
    if (scheduled.has(grid)) return;
    scheduled.add(grid);

    requestAnimationFrame(function () {
      scheduled.delete(grid);
      groupGrid(grid);
    });
  }

  function watch(grid) {
    schedule(grid);

    var observer = new MutationObserver(function () {
      var hasDirectCards = grid.querySelector(":scope > .character-card");
      if (hasDirectCards) schedule(grid);
    });

    observer.observe(grid, { childList: true });
  }

  function rememberAdminUsername() {
    var input = document.getElementById("usernameInput");
    var password = document.getElementById("passwordInput");
    var login = document.getElementById("loginBtn");
    var app = document.getElementById("adminApp");
    if (!input || !password || !login || !app) return;

    var key = "thoughts_admin_username";
    var remembered = localStorage.getItem(key);
    var pending = "";

    if (remembered) input.value = remembered;

    function capture() {
      pending = input.value.trim();
    }

    login.addEventListener("click", capture, true);
    [input, password].forEach(function (field) {
      field.addEventListener(
        "keydown",
        function (event) {
          if (event.key === "Enter") capture();
        },
        true
      );
    });

    new MutationObserver(function () {
      if (!app.hidden && pending) {
        localStorage.setItem(key, pending);
        pending = "";
      }
    }).observe(app, { attributes: true, attributeFilter: ["hidden"] });
  }

  function loadSynopsisTool(next) {
    var existing = document.querySelector('script[src="js/thoughts-synopsis.js"]');

    if (existing) {
      if (existing.dataset.loaded === "true") {
        next();
      } else {
        existing.addEventListener("load", next, { once: true });
      }
      return;
    }

    var script = document.createElement("script");
    script.src = "js/thoughts-synopsis.js";
    script.addEventListener(
      "load",
      function () {
        script.dataset.loaded = "true";
        next();
      },
      { once: true }
    );
    document.body.appendChild(script);
  }

  function loadStoryWorkspaceSongTool() {
    if (!document.getElementById("adminApp")) return;
    if (document.querySelector('script[src="js/thoughts-story-song-workspace.js"]')) return;

    var helper = document.createElement("script");
    helper.src = "js/thoughts-story-song-workspace.js";
    document.body.appendChild(helper);
  }

  function loadAdminEndingSongTool() {
    if (!document.getElementById("adminApp")) return;

    var existing = document.querySelector(
      'script[src="js/thoughts-ending-song-admin.js"]'
    );

    if (existing) {
      if (existing.dataset.loaded === "true") {
        loadStoryWorkspaceSongTool();
      } else {
        existing.addEventListener("load", loadStoryWorkspaceSongTool, {
          once: true,
        });
      }
      return;
    }

    var script = document.createElement("script");
    script.src = "js/thoughts-ending-song-admin.js";
    script.addEventListener(
      "load",
      function () {
        script.dataset.loaded = "true";
        loadStoryWorkspaceSongTool();
      },
      { once: true }
    );
    document.body.appendChild(script);
  }

  function loadAdminCollapse(next) {
    if (!document.getElementById("adminApp")) {
      next();
      return;
    }

    var existing = document.querySelector(
      'script[src="js/thoughts-collapse.js"]'
    );

    if (existing) {
      if (existing.dataset.loaded === "true") {
        next();
      } else {
        existing.addEventListener("load", next, { once: true });
      }
      return;
    }

    var script = document.createElement("script");
    script.src = "js/thoughts-collapse.js";
    script.addEventListener(
      "load",
      function () {
        script.dataset.loaded = "true";
        next();
      },
      { once: true }
    );
    document.body.appendChild(script);
  }

  function waitForSortable(next) {
    var attempts = 0;

    function check() {
      attempts += 1;
      var host = document.getElementById("adminSeriesList");
      var blocks = host
        ? Array.from(host.querySelectorAll(":scope > .admin-series-block"))
        : [];
      var ready =
        !blocks.length ||
        blocks.every(function (block) {
          return Boolean(block.getAttribute("data-sort-id"));
        });

      if (ready || attempts > 120) {
        next();
        return;
      }

      requestAnimationFrame(check);
    }

    check();
  }

  function loadAdminSortable(next) {
    if (!document.getElementById("adminApp")) {
      next();
      return;
    }

    var existing = document.querySelector(
      'script[src="js/thoughts-sortable.js"]'
    );

    if (existing) {
      if (existing.dataset.loaded === "true") {
        waitForSortable(next);
      } else {
        existing.addEventListener(
          "load",
          function () {
            waitForSortable(next);
          },
          { once: true }
        );
      }
      return;
    }

    var script = document.createElement("script");
    script.src = "js/thoughts-sortable.js";
    script.addEventListener(
      "load",
      function () {
        script.dataset.loaded = "true";
        waitForSortable(next);
      },
      { once: true }
    );
    document.body.appendChild(script);
  }

  function loadAdminContentSync(next) {
    if (!document.getElementById("adminApp")) {
      next();
      return;
    }

    var existing = document.querySelector(
      'script[src="js/thoughts-content-sync.js"]'
    );

    if (existing) {
      if (existing.dataset.loaded === "true") {
        next();
      } else {
        existing.addEventListener("load", next, { once: true });
      }
      return;
    }

    var script = document.createElement("script");
    script.src = "js/thoughts-content-sync.js";
    script.addEventListener(
      "load",
      function () {
        script.dataset.loaded = "true";
        next();
      },
      { once: true }
    );
    document.body.appendChild(script);
  }

  function init() {
    GRID_IDS.forEach(function (id) {
      var grid = document.getElementById(id);
      if (grid) watch(grid);
    });

    rememberAdminUsername();

    loadAdminContentSync(function () {
      loadSynopsisTool(function () {
        loadAdminSortable(function () {
          loadAdminCollapse(loadAdminEndingSongTool);
        });
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();