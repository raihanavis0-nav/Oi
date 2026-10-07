(function () {
  "use strict";

  var loadedSlug = "";
  var audio = null;
  var endingObserver = null;
  var bodyObserver = null;
  var endingWatchTimer = 0;
  var popupShown = false;
  var autoplayTriggered = false;
  var playerTouched = false;
  var songSlug = "";
  var scrollCheckQueued = false;

  function $(id) {
    return document.getElementById(id);
  }

  function currentSlug() {
    return new URLSearchParams(window.location.search).get("story") || "";
  }

  function sortStories(a, b) {
    var order = Number(a.order || 0) - Number(b.order || 0);
    if (order) return order;

    var date = String(a.date || "").localeCompare(String(b.date || ""));
    if (date) return date;

    return String(a.title || "").localeCompare(String(b.title || ""));
  }

  function wordCount(value) {
    var text = String(value || "").trim();
    return text ? text.split(/\s+/).length : 0;
  }

  function updatePlayer() {
    if (!audio) return;
    var play = $("endingSongPlay");
    if (!play) return;

    var playing = !audio.paused && !audio.ended;
    play.textContent = playing ? "Pause" : "Play";
    play.setAttribute("aria-pressed", playing ? "true" : "false");
  }

  function disconnectEndingObserver() {
    if (endingObserver) {
      endingObserver.disconnect();
      endingObserver = null;
    }
  }

  function disconnectBodyObserver() {
    if (bodyObserver) {
      bodyObserver.disconnect();
      bodyObserver = null;
    }
  }

  function resetPlayerState() {
    window.clearTimeout(endingWatchTimer);
    endingWatchTimer = 0;
    disconnectEndingObserver();
    disconnectBodyObserver();

    popupShown = false;
    autoplayTriggered = false;
    playerTouched = false;
    songSlug = "";
    scrollCheckQueued = false;
  }

  function hideCard() {
    resetPlayerState();

    var card = $("endingSongCard");
    if (card) {
      card.classList.remove("is-visible");
      card.hidden = true;
    }

    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      updatePlayer();
    }
  }

  function attemptAutoplay() {
    if (
      !audio ||
      !audio.src ||
      autoplayTriggered ||
      playerTouched ||
      songSlug !== currentSlug()
    ) {
      return;
    }

    autoplayTriggered = true;
    audio.play().catch(function () {
      // Audible autoplay may be blocked by the browser. The popup stays
      // visible and the normal Play button remains available.
      updatePlayer();
    });
  }

  function revealPopup() {
    var card = $("endingSongCard");
    if (!card || popupShown || songSlug !== currentSlug()) return;

    popupShown = true;
    card.hidden = false;

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (!card.hidden && songSlug === currentSlug()) {
          card.classList.add("is-visible");
        }
      });
    });

    attemptAutoplay();
    disconnectEndingObserver();
  }

  function meaningfulBlocks() {
    var body = $("storyBody");
    if (!body) return [];

    return Array.from(
      body.querySelectorAll("p, blockquote, li, h2, h3, h4, pre, figure")
    ).filter(function (node) {
      return (
        node.tagName === "FIGURE" ||
        wordCount(node.textContent) > 0
      );
    });
  }

  function endingAnchor() {
    var body = $("storyBody");
    if (!body) return null;

    var blocks = meaningfulBlocks();
    if (!blocks.length) return body;

    var remainingWords = 0;
    var wordIndex = blocks.length - 1;

    while (wordIndex > 0 && remainingWords < 250) {
      remainingWords += wordCount(blocks[wordIndex].textContent);
      wordIndex -= 1;
    }

    // For short stories, do not surface the popup too early. The semantic
    // target is roughly the last 250 words, but never before the final third.
    var finalThirdIndex = Math.floor(blocks.length * 0.66);
    var wordAnchorIndex = Math.min(wordIndex + 1, blocks.length - 1);
    var anchorIndex = Math.max(wordAnchorIndex, finalThirdIndex);
    return blocks[anchorIndex];
  }

  function isNearEndingByGeometry() {
    var body = $("storyBody");
    var storyView = $("storyView");
    if (!body || !storyView || storyView.hidden || !songSlug) return false;

    var rect = body.getBoundingClientRect();
    if (!rect.height) return false;

    var threshold = Math.min(1050, Math.max(480, rect.height * 0.18));
    return rect.bottom - window.innerHeight <= threshold;
  }

  function checkGeometryFallback() {
    scrollCheckQueued = false;
    if (popupShown || songSlug !== currentSlug()) return;
    if (isNearEndingByGeometry()) revealPopup();
  }

  function scheduleGeometryCheck() {
    if (scrollCheckQueued || popupShown || !songSlug) return;
    scrollCheckQueued = true;
    requestAnimationFrame(checkGeometryFallback);
  }

  function watchEndingZone() {
    disconnectEndingObserver();

    var anchor = endingAnchor();
    if (!anchor) return;

    if (typeof IntersectionObserver === "function") {
      endingObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.target === anchor && entry.isIntersecting) {
              revealPopup();
            }
          });
        },
        {
          root: null,
          rootMargin: "0px 0px 12% 0px",
          threshold: 0.01,
        }
      );
      endingObserver.observe(anchor);
    }

    scheduleGeometryCheck();
  }

  function scheduleEndingWatch() {
    if (!songSlug || popupShown) return;
    window.clearTimeout(endingWatchTimer);
    endingWatchTimer = window.setTimeout(watchEndingZone, 90);
  }

  function observeStoryBody() {
    disconnectBodyObserver();
    var body = $("storyBody");
    if (!body || typeof MutationObserver !== "function") return;

    bodyObserver = new MutationObserver(function () {
      scheduleEndingWatch();
    });
    bodyObserver.observe(body, {
      childList: true,
      subtree: true,
    });
  }

  function preparePopup(kicker, song) {
    var card = $("endingSongCard");
    if (!card || !song || !song.path) return;

    $("endingSongKicker").textContent = kicker;
    $("endingSongTitle").textContent = song.title || "Ending song";
    $("endingSongArtist").textContent = song.artist || "";
    $("endingSongArtist").hidden = !song.artist;

    songSlug = currentSlug();
    popupShown = false;
    autoplayTriggered = false;
    playerTouched = false;

    card.classList.remove("is-visible");
    card.hidden = true;

    audio.src =
      "/api/thoughts/media?path=" + encodeURIComponent(String(song.path));
    audio.load();
    updatePlayer();

    observeStoryBody();
    scheduleEndingWatch();
  }

  function render() {
    var slug = currentSlug();
    var storyView = $("storyView");

    if (!slug || !storyView || storyView.hidden || loadedSlug === slug) return;
    loadedSlug = slug;
    hideCard();

    fetch("/api/thoughts/content", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(function (response) {
        if (!response.ok) throw new Error("Could not load ending song.");
        return response.json();
      })
      .then(function (result) {
        if (currentSlug() !== slug) return;

        var data = (result && result.data) || {};
        var stories = Array.isArray(data.stories) ? data.stories : [];
        var subseriesItems = Array.isArray(data.subseries) ? data.subseries : [];

        var story = stories.find(function (item) {
          return item && item.slug === slug;
        });
        if (!story) return;

        if (story.endingSong && story.endingSong.path) {
          preparePopup(
            "After " + (story.title || "this story"),
            story.endingSong
          );
          return;
        }

        if (!story.subseriesId) return;

        var siblings = stories
          .filter(function (item) {
            return item && item.subseriesId === story.subseriesId;
          })
          .sort(sortStories);

        if (!siblings.length || siblings[siblings.length - 1].id !== story.id) {
          return;
        }

        var subseries = subseriesItems.find(function (item) {
          return item && item.id === story.subseriesId;
        });
        if (!subseries || !subseries.endingSong || !subseries.endingSong.path) {
          return;
        }

        preparePopup(
          "End of " + (subseries.name || "Sub-series"),
          subseries.endingSong
        );
      })
      .catch(function () {
        hideCard();
      });
  }

  function init() {
    audio = $("endingSongAudio");
    var card = $("endingSongCard");
    var play = $("endingSongPlay");
    if (!audio || !card || !play) return;

    play.addEventListener("click", function () {
      if (!audio.src) return;
      playerTouched = true;

      if (audio.paused) {
        audio.play().catch(function () {
          updatePlayer();
        });
      } else {
        audio.pause();
      }
    });

    ["loadedmetadata", "play", "pause", "ended"].forEach(function (eventName) {
      audio.addEventListener(eventName, updatePlayer);
    });

    audio.addEventListener("ended", function () {
      audio.currentTime = 0;
      updatePlayer();
    });

    window.addEventListener("scroll", scheduleGeometryCheck, {
      passive: true,
    });
    window.addEventListener("resize", scheduleGeometryCheck, {
      passive: true,
    });

    var storyView = $("storyView");
    var observer = new MutationObserver(function () {
      if (!storyView.hidden) {
        loadedSlug = "";
        render();
      } else {
        hideCard();
      }
    });
    observer.observe(storyView, {
      attributes: true,
      attributeFilter: ["hidden"],
    });

    window.addEventListener("popstate", function () {
      loadedSlug = "";
      render();
    });

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
