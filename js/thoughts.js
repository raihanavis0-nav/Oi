(function () {
  "use strict";

  var API = {
    content: "/api/thoughts/content",
    media: "/api/thoughts/media",
  };

  var state = {
    data: {
      series: [],
      subseries: [],
      characters: [],
      stories: [],
    },
  };

  function $(id) {
    return document.getElementById(id);
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

  function setupThemeSwitch() {
    setTheme(document.documentElement.dataset.theme || "light", false);

    document.querySelectorAll("[data-theme-choice]").forEach(function (button) {
      button.addEventListener("click", function () {
        setTheme(button.getAttribute("data-theme-choice"), true);
      });
    });
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

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
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

  function looksLikeRichHtml(value) {
    return /<(?:p|div|h[2-4]|blockquote|ul|ol|li|figure|figcaption|span|strong|b|em|i|u|s|strike|br|pre|code|font|sub|sup|hr)\b/i.test(
      String(value || "")
    );
  }

  function renderStoryBody(story) {
    var body = $("storyBody");
    var source = String((story && story.body) || "");

    if (
      looksLikeRichHtml(source) &&
      window.ThoughtsRichContent &&
      typeof window.ThoughtsRichContent.forDisplay === "function"
    ) {
      body.innerHTML = window.ThoughtsRichContent.forDisplay(
        source,
        API.media
      );
      body.dataset.storyRender = "rich";
      return;
    }

    body.innerHTML = markdownToHtml(source);
    body.dataset.storyRender = "markdown";
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
      if (line.trim().slice(0, 3) === String.fromCharCode(96, 96, 96)) {
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

  function formatDate(iso) {
    var date = new Date(String(iso || "") + "T12:00:00");
    if (Number.isNaN(date.getTime())) return iso || "";

    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
  }

  function formatShortDate(iso) {
    var date = new Date(String(iso || "") + "T12:00:00");
    if (Number.isNaN(date.getTime())) return "";

    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
    }).format(date);
  }

  function sortByOrderName(a, b) {
    var ao = Number(a.order || 0);
    var bo = Number(b.order || 0);

    if (ao !== bo) return ao - bo;

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

  function storyUrl(slug) {
    return "read?story=" + encodeURIComponent(slug);
  }

  function createStoryList(stories) {
    var list = document.createElement("div");
    list.className = "story-list";

    stories.slice().sort(sortStories).forEach(function (story, index) {
      var row = document.createElement("div");
      row.className = "story-row";

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

  function renderSeries() {
    var host = $("seriesList");
    host.innerHTML = "";

    var stories = state.data.stories || [];
    var seriesItems = state.data.series.slice().sort(sortByOrderName);

    seriesItems.forEach(function (series) {
      var directStories = stories.filter(function (story) {
        return story.seriesId === series.id && !story.subseriesId;
      });

      var subseriesItems = state.data.subseries
        .filter(function (subseries) {
          return subseries.seriesId === series.id;
        })
        .sort(sortByOrderName);

      var hasNestedStories = subseriesItems.some(function (subseries) {
        return stories.some(function (story) {
          return story.subseriesId === subseries.id;
        });
      });

      if (!directStories.length && !hasNestedStories) return;

      var seriesStories = stories.filter(function (story) {
        return story.seriesId === series.id;
      });
      var defaultFocus =
        series.focus === "cover" && series.coverImage ? "cover" : "title";
      var savedFocus = "";
      try {
        savedFocus = localStorage.getItem(
          "archive_series_focus_" + String(series.id || "")
        ) || "";
      } catch (_) {}

      var focus =
        series.coverImage && (savedFocus === "title" || savedFocus === "cover")
          ? savedFocus
          : defaultFocus;

      var block = document.createElement("section");
      block.className = "series-block series-focus-" + focus;

      var feature = document.createElement("div");
      feature.className = "series-feature";

      var content = document.createElement("div");
      content.className = "series-feature-content";

      var titleRow = document.createElement("div");
      titleRow.className = "series-title-row";

      var title = document.createElement("h3");
      title.className = "series-title";
      title.textContent = series.name || "Untitled series";

      var headingTools = document.createElement("div");
      headingTools.className = "series-heading-tools";

      var count = document.createElement("span");
      count.className = "series-meta";
      count.textContent =
        seriesStories.length +
        (seriesStories.length === 1 ? " story" : " stories");
      headingTools.appendChild(count);

      if (series.coverImage) {
        var focusSwitch = document.createElement("div");
        focusSwitch.className = "series-focus-switch";
        focusSwitch.setAttribute("role", "group");
        focusSwitch.setAttribute(
          "aria-label",
          "Display focus for " + (series.name || "Series")
        );

        ["title", "cover"].forEach(function (choice) {
          var focusButton = document.createElement("button");
          focusButton.type = "button";
          focusButton.textContent = choice === "title" ? "Title" : "Cover";
          focusButton.setAttribute("data-series-focus", choice);
          focusButton.setAttribute(
            "aria-pressed",
            choice === focus ? "true" : "false"
          );

          focusButton.addEventListener("click", function () {
            try {
              localStorage.setItem(
                "archive_series_focus_" + String(series.id || ""),
                choice
              );
            } catch (_) {}
            renderSeries();
          });

          focusSwitch.appendChild(focusButton);
        });

        headingTools.appendChild(focusSwitch);
      }

      titleRow.appendChild(title);
      titleRow.appendChild(headingTools);
      content.appendChild(titleRow);

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

        var coverImage = document.createElement("img");
        coverImage.src = mediaUrl(series.coverImage);
        coverImage.alt = (series.name || "Series") + " book cover";
        coverImage.loading = "lazy";

        cover.appendChild(coverImage);
      }

      function appendStoryGroups(container) {
        if (directStories.length) {
          container.appendChild(createStoryList(directStories));
        }

        subseriesItems.forEach(function (subseries) {
          var nestedStories = stories.filter(function (story) {
            return story.subseriesId === subseries.id;
          });

          if (!nestedStories.length) return;

          var nested = document.createElement("section");
          nested.className = "subseries-block";

          var nestedTitle = document.createElement("h4");
          nestedTitle.className = "subseries-title";
          nestedTitle.textContent = subseries.name || "Untitled sub-series";
          nested.appendChild(nestedTitle);

          if (subseries.description) {
            var nestedDescription = document.createElement("p");
            nestedDescription.className = "subseries-description";
            nestedDescription.textContent = subseries.description;
            nested.appendChild(nestedDescription);
          }

          nested.appendChild(createStoryList(nestedStories));
          container.appendChild(nested);
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

      host.appendChild(block);
    });
  }

  function characterMeta(character) {
    var series = seriesById(character.seriesId);
    var subseries = subseriesById(character.subseriesId);
    var parts = [];

    if (series) parts.push(series.name);
    if (subseries) parts.push(subseries.name);

    return parts.join(" / ");
  }

  function renderCharacters() {
    var section = $("charactersSection");
    var grid = $("characterGrid");
    grid.innerHTML = "";

    var characters = state.data.characters
      .slice()
      .sort(sortByOrderName);

    if (!characters.length) {
      section.hidden = true;
      return;
    }

    section.hidden = false;

    characters.forEach(function (character) {
      var card = document.createElement("article");
      card.className = "character-card";

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

      var metaText = characterMeta(character);
      if (metaText) {
        var meta = document.createElement("p");
        meta.className = "character-meta";
        meta.textContent = metaText;
        card.appendChild(meta);
      }

      if (character.bio) {
        var bio = document.createElement("p");
        bio.className = "character-bio";
        bio.textContent = character.bio;
        card.appendChild(bio);
      }

      grid.appendChild(card);
    });
  }

  function renderHome() {
    $("libraryHome").hidden = false;
    $("storyView").hidden = true;
    document.title = "Archive";

    renderSeries();
    renderCharacters();

    var hasStories = state.data.stories.length > 0;
    $("seriesSection").hidden = !hasStories;
    $("emptyState").hidden = hasStories || state.data.characters.length > 0;
  }

  function renderStoryCharacters(story) {
    var host = $("storyCharacters");
    host.innerHTML = "";

    var characters = (story.characterIds || [])
      .map(characterById)
      .filter(Boolean);

    if (!characters.length) {
      host.hidden = true;
      return;
    }

    characters.forEach(function (character) {
      var chip = document.createElement("div");
      chip.className = "story-character-chip";

      if (character.portrait) {
        var image = document.createElement("img");
        image.src = mediaUrl(character.portrait);
        image.alt = "";
        image.loading = "lazy";
        chip.appendChild(image);
      } else {
        var placeholder = document.createElement("span");
        placeholder.className = "avatar-placeholder";
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

    host.hidden = false;
  }

  function renderStoryNav(story) {
    var prev = $("prevStory");
    var next = $("nextStory");

    prev.hidden = true;
    next.hidden = true;

    var siblings = state.data.stories
      .filter(function (item) {
        if (item.seriesId !== story.seriesId) return false;

        if (story.subseriesId) {
          return item.subseriesId === story.subseriesId;
        }

        return !item.subseriesId;
      })
      .sort(sortStories);

    var index = siblings.findIndex(function (item) {
      return item.id === story.id;
    });

    if (index > 0) {
      var previous = siblings[index - 1];
      prev.href = storyUrl(previous.slug);
      prev.textContent = "← " + previous.title;
      prev.hidden = false;
    }

    if (index >= 0 && index < siblings.length - 1) {
      var following = siblings[index + 1];
      next.href = storyUrl(following.slug);
      next.textContent = following.title + " →";
      next.hidden = false;
    }

    $("storyNav").hidden = prev.hidden && next.hidden;
  }

  function renderStory(story) {
    var series = seriesById(story.seriesId);
    var subseries = subseriesById(story.subseriesId);
    var path = [];

    if (series) path.push(series.name);
    if (subseries) path.push(subseries.name);

    $("storyPath").textContent = path.join(" / ");

    var cover = $("storyCover");
    var coverImage = $("storyCoverImage");
    if (story.headerImage) {
      var coverPosition = Math.max(
        0,
        Math.min(100, Number(story.headerImagePosition == null ? 50 : story.headerImagePosition))
      );
      coverImage.src = mediaUrl(story.headerImage);
      coverImage.alt = (story.title || "Story") + " header";
      coverImage.style.objectPosition = "50% " + coverPosition + "%";
      cover.hidden = false;
    } else {
      cover.hidden = true;
      coverImage.removeAttribute("src");
      coverImage.alt = "";
    }

    $("storyTitle").textContent = story.title || "Untitled";
    $("storyDate").textContent = formatDate(story.date);
    renderStoryBody(story);

    renderStoryCharacters(story);
    renderStoryNav(story);

    $("libraryHome").hidden = true;
    $("storyView").hidden = false;
    document.title = (story.title || "Story") + " — Archive";
  }

  function renderLibrary() {
    var params = new URLSearchParams(window.location.search);
    var slug = params.get("story");

    if (!slug) {
      renderHome();
      return;
    }

    var story = state.data.stories.find(function (item) {
      return item.slug === slug;
    });

    if (!story) {
      renderHome();
      return;
    }

    renderStory(story);
  }

  function showLibrary() {
    document.body.classList.remove("is-locked");
    $("libraryApp").hidden = false;
  }

  function loadLibrary() {
    return apiJson(API.content)
      .then(function (result) {
        var data = result.data || {};
        state.data = {
          series: Array.isArray(data.series) ? data.series : [],
          subseries: Array.isArray(data.subseries) ? data.subseries : [],
          characters: Array.isArray(data.characters) ? data.characters : [],
          stories: Array.isArray(data.stories) ? data.stories : [],
        };

        showLibrary();
        renderLibrary();
      })
      .catch(function (error) {
        showLibrary();
        var empty = $("emptyState");
        if (empty) {
          empty.hidden = false;
          var message = empty.querySelector("p");
          if (message) message.textContent = "The archive could not be loaded right now.";
        }
        console.error("Stories library:", error);
      });
  }

  function wire() {
    setupThemeSwitch();
    loadLibrary();
  }

  document.addEventListener("DOMContentLoaded", wire);
})();
