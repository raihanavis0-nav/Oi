(function () {
  "use strict";

  var renderedSlug = "";
  var loading = false;

  function $(id) {
    return document.getElementById(id);
  }

  function looksLikeRichHtml(value) {
    return /<(?:p|div|h[2-4]|blockquote|ul|ol|li|figure|span|strong|em|u|s|br|pre)\b/i.test(
      String(value || "")
    );
  }

  function currentSlug() {
    return new URLSearchParams(window.location.search).get("story") || "";
  }

  function renderRichStory() {
    var slug = currentSlug();
    var storyView = $("storyView");
    var body = $("storyBody");

    if (!slug || !storyView || storyView.hidden || !body || loading || renderedSlug === slug) {
      return;
    }

    if (body.dataset.storyRender === "rich") {
      renderedSlug = slug;
      return;
    }

    loading = true;

    fetch("/api/thoughts/content", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(function (response) {
        if (!response.ok) throw new Error("Could not load rich story body.");
        return response.json();
      })
      .then(function (result) {
        var stories = result && result.data && Array.isArray(result.data.stories)
          ? result.data.stories
          : [];
        var story = stories.find(function (item) {
          return item && item.slug === slug;
        });

        if (!story || !looksLikeRichHtml(story.body) || !window.ThoughtsRichContent) {
          renderedSlug = slug;
          return;
        }

        body.innerHTML = window.ThoughtsRichContent.forDisplay(
          story.body || "",
          "/api/thoughts/media"
        );
        body.dataset.storyRender = "rich";
        renderedSlug = slug;
      })
      .catch(function () {
        return null;
      })
      .finally(function () {
        loading = false;
      });
  }

  function init() {
    var storyView = $("storyView");
    if (!storyView) return;

    var observer = new MutationObserver(renderRichStory);
    observer.observe(storyView, {
      attributes: true,
      attributeFilter: ["hidden"],
    });

    renderRichStory();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
