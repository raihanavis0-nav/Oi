(function () {
  "use strict";

  var loading = false;
  var queued = false;

  function $(id) {
    return document.getElementById(id);
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

  function formatShortDate(iso) {
    var date = new Date(String(iso || "") + "T12:00:00");
    if (Number.isNaN(date.getTime())) return "";

    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
    }).format(date);
  }

  function storyUrl(slug) {
    return "read?story=" + encodeURIComponent(String(slug || ""));
  }

  function mediaUrl(path) {
    return "/api/thoughts/media?path=" + encodeURIComponent(String(path || ""));
  }

  function seriesFocus(series) {
    var defaultFocus =
      series && series.focus === "cover" && series.coverImage ? "cover" : "title";
    var saved = "";

    try {
      saved = localStorage.getItem(
        "archive_series_focus_" + String((series && series.id) || "")
      ) || "";
    } catch (_) {}

    if (
      series &&
      series.coverImage &&
      (saved === "title" || saved === "cover")
    ) {
      return saved;
    }

    return defaultFocus;
  }

  function makeStoryList(stories) {
    var list = document.createElement("div");
    list.className = "story-list";

    stories
      .slice()
      .sort(sortStories)
      .forEach(function (story, index) {
        if (!story) return;

        var row = document.createElement("div");
        row.className = "story-row";
        row.setAttribute("data-story-id", String(story.id || ""));

        var order = document.createElement("span");
        order.className = "story-index";
        var displayOrder =
          Number(story.order || 0) > 0 ? Number(story.order) : index + 1;
        order.textContent = String(displayOrder).padStart(2, "0");

        var titleStack = document.createElement("div");
        titleStack.className = "story-title-stack";

        var link = document.createElement("a");
        link.href = storyUrl(story.slug);
        link.textContent = story.title || "Untitled";
        titleStack.appendChild(link);

        var synopsisText = String(story.synopsis || "").trim();
        if (synopsisText) {
          row.classList.add("has-list-synopsis");

          var synopsis = document.createElement("p");
          synopsis.className = "story-list-synopsis";
          synopsis.textContent = synopsisText;
          synopsis.title = synopsisText;
          titleStack.appendChild(synopsis);
        }

        var time = document.createElement("time");
        time.dateTime = story.date || "";
        time.textContent = formatShortDate(story.date);

        row.appendChild(order);
        row.appendChild(titleStack);
        row.appendChild(time);
        list.appendChild(row);
      });

    return list;
  }

  function makeSubseriesBlock(subseries, stories) {
    var block = document.createElement("section");
    block.className = "subseries-block";
    block.setAttribute("data-subseries-id", String(subseries.id || ""));

    var title = document.createElement("h4");
    title.className = "subseries-title";
    title.textContent = subseries.name || "Untitled sub-series";
    block.appendChild(title);

    if (subseries.description) {
      var description = document.createElement("p");
      description.className = "subseries-description";
      description.textContent = subseries.description;
      block.appendChild(description);
    }

    if (stories.length) block.appendChild(makeStoryList(stories));
    return block;
  }

  function makeSeriesBlock(series, directStories, subseriesItems, allStories, data) {
    var focus = seriesFocus(series);
    var block = document.createElement("section");
    block.className = "series-block series-focus-" + focus;
    block.setAttribute("data-series-id", String(series.id || ""));

    var feature = document.createElement("div");
    feature.className = "series-feature";

    var content = document.createElement("div");
    content.className = "series-feature-content";

    var row = document.createElement("div");
    row.className = "series-title-row";

    var title = document.createElement("h3");
    title.className = "series-title";
    title.textContent = series.name || "Untitled series";

    var storyCount = allStories.filter(function (story) {
      return story && String(story.seriesId || "") === String(series.id || "");
    }).length;

    var headingTools = document.createElement("div");
    headingTools.className = "series-heading-tools";

    var meta = document.createElement("span");
    meta.className = "series-meta";
    meta.textContent =
      storyCount + (storyCount === 1 ? " story" : " stories");
    headingTools.appendChild(meta);

    if (series.coverImage) {
      var focusSwitch = document.createElement("div");
      focusSwitch.className = "series-focus-switch";
      focusSwitch.setAttribute("role", "group");
      focusSwitch.setAttribute(
        "aria-label",
        "Display focus for " + (series.name || "Series")
      );

      ["title", "cover"].forEach(function (choice) {
        var button = document.createElement("button");
        button.type = "button";
        button.textContent = choice === "title" ? "Title" : "Cover";
        button.setAttribute("data-series-focus", choice);
        button.setAttribute(
          "aria-pressed",
          choice === focus ? "true" : "false"
        );

        button.addEventListener("click", function () {
          try {
            localStorage.setItem(
              "archive_series_focus_" + String(series.id || ""),
              choice
            );
          } catch (_) {}

          renderLatest(data);
        });

        focusSwitch.appendChild(button);
      });

      headingTools.appendChild(focusSwitch);
    }

    row.appendChild(title);
    row.appendChild(headingTools);
    content.appendChild(row);

    if (series.description) {
      var description = document.createElement("p");
      description.className = "series-description";
      description.textContent = series.description;
      content.appendChild(description);
    }

    var cover = null;
    if (series.coverImage) {
      cover = document.createElement("figure");
      cover.className = "series-book-cover";

      var image = document.createElement("img");
      image.src = mediaUrl(series.coverImage);
      image.alt = (series.name || "Series") + " book cover";
      image.loading = "lazy";

      cover.appendChild(image);
    }

    function appendStoryGroups(container) {
      if (directStories.length) {
        container.appendChild(makeStoryList(directStories));
      }

      subseriesItems.forEach(function (subseries) {
        var nestedStories = allStories.filter(function (story) {
          return (
            story &&
            String(story.subseriesId || "") === String(subseries.id || "")
          );
        });
        container.appendChild(makeSubseriesBlock(subseries, nestedStories));
      });
    }

    if (focus === "cover") {
      if (cover) feature.appendChild(cover);
      feature.appendChild(content);
      appendStoryGroups(content);
      block.appendChild(feature);
    } else {
      feature.appendChild(content);
      if (cover) feature.appendChild(cover);
      block.appendChild(feature);
      appendStoryGroups(block);
    }

    return block;
  }

  function renderLatest(data) {
    var host = $("seriesList");
    if (!host) return;

    var series = Array.isArray(data.series) ? data.series.slice() : [];
    var subseries = Array.isArray(data.subseries) ? data.subseries.slice() : [];
    var stories = Array.isArray(data.stories) ? data.stories.filter(Boolean) : [];

    host.innerHTML = "";

    series.sort(sortByOrderName).forEach(function (item) {
      var directStories = stories.filter(function (story) {
        return (
          String(story.seriesId || "") === String(item.id || "") &&
          !story.subseriesId
        );
      });

      var nested = subseries
        .filter(function (sub) {
          return String(sub.seriesId || "") === String(item.id || "");
        })
        .sort(sortByOrderName);

      host.appendChild(
        makeSeriesBlock(item, directStories, nested, stories, data)
      );
    });

    var seriesSection = $("seriesSection");
    var emptyState = $("emptyState");
    if (seriesSection) seriesSection.hidden = series.length === 0;
    if (emptyState) emptyState.hidden = series.length > 0;
  }

  function load() {
    var app = $("libraryApp");
    var home = $("libraryHome");
    if (!app || app.hidden || (home && home.hidden) || loading) return;

    loading = true;

    fetch("/api/thoughts/content", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(function (response) {
        if (!response.ok) throw new Error("Could not refresh archive.");
        return response.json();
      })
      .then(function (result) {
        renderLatest(result.data || {});
      })
      .catch(function () {
        // Keep the primary reader render intact if the refresh request fails.
      })
      .finally(function () {
        loading = false;
      });
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      load();
    });
  }

  function init() {
    var app = $("libraryApp");
    if (!app || !$("seriesList")) return;

    new MutationObserver(schedule).observe(app, {
      attributes: true,
      attributeFilter: ["hidden"],
    });

    var home = $("libraryHome");
    if (home) {
      new MutationObserver(schedule).observe(home, {
        attributes: true,
        attributeFilter: ["hidden"],
      });
    }

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) schedule();
    });
    window.addEventListener("focus", schedule);
    window.addEventListener("pageshow", schedule);

    schedule();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
