(function () {
  "use strict";

  var grid = null;
  var observer = null;
  var scheduled = false;

  function characterInfo(card) {
    var name = card.querySelector("h3");
    var meta = card.querySelector(".character-meta");
    var bio = card.querySelector(".character-bio");
    var image = card.querySelector(".character-portrait");
    var placeholder = card.querySelector(".character-portrait-placeholder");

    return {
      name: name ? name.textContent.trim() : "Unnamed",
      meta: meta && !meta.hidden ? meta.textContent.trim() : "",
      bio: bio ? bio.textContent.trim() : "",
      imageSrc: image ? image.currentSrc || image.src : "",
      imageAlt: image ? image.alt || "" : "",
      initials: placeholder ? placeholder.textContent.trim() : "",
    };
  }

  function ensureDialog() {
    var existing = document.getElementById("characterDetailDialog");
    if (existing) return existing;

    var dialog = document.createElement("dialog");
    dialog.id = "characterDetailDialog";
    dialog.className = "character-detail-dialog";
    dialog.innerHTML =
      '<div class="character-detail-shell">' +
      '<button class="character-detail-close" type="button" aria-label="Close character details">×</button>' +
      '<div class="character-detail-portrait" id="characterDetailPortrait"></div>' +
      '<div class="character-detail-copy">' +
      '<p class="character-detail-kicker">Character</p>' +
      '<h2 id="characterDetailName"></h2>' +
      '<p class="character-detail-meta" id="characterDetailMeta"></p>' +
      '<div class="character-detail-rule" aria-hidden="true"></div>' +
      '<p class="character-detail-bio" id="characterDetailBio"></p>' +
      "</div>" +
      "</div>";

    document.body.appendChild(dialog);

    dialog.querySelector(".character-detail-close").addEventListener("click", function () {
      dialog.close();
    });

    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) dialog.close();
    });

    return dialog;
  }

  function openDetails(card) {
    var info = characterInfo(card);
    var dialog = ensureDialog();
    var portrait = document.getElementById("characterDetailPortrait");
    var name = document.getElementById("characterDetailName");
    var meta = document.getElementById("characterDetailMeta");
    var bio = document.getElementById("characterDetailBio");

    portrait.innerHTML = "";

    if (info.imageSrc) {
      var image = document.createElement("img");
      image.src = info.imageSrc;
      image.alt = info.imageAlt || info.name + " portrait";
      portrait.appendChild(image);
    } else {
      var placeholder = document.createElement("div");
      placeholder.className = "character-detail-placeholder";
      placeholder.textContent = info.initials || info.name.slice(0, 2).toUpperCase();
      portrait.appendChild(placeholder);
    }

    name.textContent = info.name;
    meta.textContent = info.meta;
    meta.hidden = !info.meta;
    bio.textContent = info.bio || "No description yet.";

    if (!dialog.open) dialog.showModal();
  }

  function activatePortrait(card) {
    if (!card || card.dataset.characterDetailReady === "true") return;

    var target = card.querySelector(
      ".character-portrait, .character-portrait-placeholder"
    );
    if (!target) return;

    var bio = card.querySelector(".character-bio");
    if (bio) bio.hidden = true;

    target.classList.add("character-detail-trigger");
    target.setAttribute("role", "button");
    target.setAttribute("tabindex", "0");
    target.setAttribute("aria-haspopup", "dialog");
    target.setAttribute(
      "aria-label",
      "View " +
        ((card.querySelector("h3") && card.querySelector("h3").textContent.trim()) ||
          "character") +
        " details"
    );

    target.addEventListener("click", function () {
      openDetails(card);
    });

    target.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openDetails(card);
    });

    card.dataset.characterDetailReady = "true";
  }

  function decorate() {
    scheduled = false;
    if (!grid) return;

    grid.querySelectorAll(".character-card").forEach(activatePortrait);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(decorate);
  }

  function init() {
    grid = document.getElementById("characterGrid");
    if (!grid) return;

    schedule();
    observer = new MutationObserver(schedule);
    observer.observe(grid, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
