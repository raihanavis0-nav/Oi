(function () {
  "use strict";

  if (!document.querySelector('link[href="css/thoughts-editor.css"]')) {
    var editorStyles = document.createElement("link");
    editorStyles.rel = "stylesheet";
    editorStyles.href = "css/thoughts-editor.css";
    document.head.appendChild(editorStyles);
  }

  var editor = null;
  var toolbar = null;
  var lastRange = null;
  var config = {};

  function $(id) {
    return document.getElementById(id);
  }

  function isInsideEditor(node) {
    return Boolean(editor && node && (node === editor || editor.contains(node)));
  }

  function safeLink(value) {
    var href = String(value || "").trim();
    if (!href) return "";
    if (/^https?:\/\//i.test(href)) return href;
    if (/^mailto:/i.test(href)) return href;
    if (/^#/.test(href)) return href;
    if (/^(\.\.?\/|\/)/.test(href) && !/^\/\//.test(href)) return href;
    return "";
  }

  function saveSelection() {
    var selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    var range = selection.getRangeAt(0);
    if (!isInsideEditor(range.commonAncestorContainer)) return;
    lastRange = range.cloneRange();
  }

  function restoreSelection() {
    if (!lastRange) {
      editor.focus();
      return;
    }

    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(lastRange);
  }

  function markChanged() {
    saveSelection();
    if (typeof config.onChange === "function") config.onChange();
    syncButtons();
  }

  function exec(command, value) {
    restoreSelection();
    editor.focus();
    try {
      document.execCommand("styleWithCSS", false, true);
    } catch (_) {}
    document.execCommand(command, false, value == null ? null : value);
    markChanged();
  }

  function currentBlock() {
    var selection = window.getSelection();
    if (!selection || !selection.rangeCount) return null;
    var node = selection.anchorNode;
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    if (!node || !editor.contains(node)) return null;
    return node.closest("p,div,h2,h3,h4,blockquote,li,pre") || editor;
  }

  function applyLineHeight(value) {
    restoreSelection();
    var block = currentBlock();
    if (!block || block === editor) return;
    block.style.lineHeight = value;
    markChanged();
  }

  function createLink() {
    restoreSelection();
    var selection = window.getSelection();
    var selected = selection && !selection.isCollapsed ? selection.toString() : "";
    var href = safeLink(window.prompt("Link URL", "https://"));
    if (!href) return;

    if (selected) {
      exec("createLink", href);
      return;
    }

    var safeText = document.createElement("a");
    safeText.href = href;
    safeText.textContent = href;
    if (/^https?:\/\//i.test(href)) {
      safeText.target = "_blank";
      safeText.rel = "noopener noreferrer";
    }
    document.execCommand("insertHTML", false, safeText.outerHTML);
    markChanged();
  }

  function insertMedia(path, alt) {
    if (!path) return;
    restoreSelection();
    editor.focus();

    var endpoint = String(config.mediaEndpoint || "");
    var figure = document.createElement("figure");
    var image = document.createElement("img");
    image.setAttribute("data-media-path", path);
    image.src = endpoint + "?path=" + encodeURIComponent(path);
    image.alt = alt || "Image";
    image.loading = "lazy";

    var caption = document.createElement("figcaption");
    caption.textContent = "Caption";

    figure.appendChild(image);
    figure.appendChild(caption);

    var paragraph = document.createElement("p");
    paragraph.innerHTML = "<br>";

    document.execCommand(
      "insertHTML",
      false,
      figure.outerHTML + paragraph.outerHTML
    );
    markChanged();
  }

  function syncButtons() {
    if (!toolbar) return;
    [
      "bold",
      "italic",
      "underline",
      "strikeThrough",
      "subscript",
      "superscript",
      "insertUnorderedList",
      "insertOrderedList",
      "justifyLeft",
      "justifyCenter",
      "justifyRight",
      "justifyFull",
    ].forEach(function (command) {
      var button = toolbar.querySelector('[data-editor-command="' + command + '"]');
      if (!button) return;
      var active = false;
      try {
        active = document.queryCommandState(command);
      } catch (_) {}
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function wireToolbar() {
    toolbar.addEventListener("mousedown", function (event) {
      if (event.target.closest("button")) event.preventDefault();
    });

    toolbar.addEventListener("click", function (event) {
      var button = event.target.closest("button");
      if (!button) return;

      var command = button.getAttribute("data-editor-command");
      if (command) {
        exec(command, button.getAttribute("data-editor-value"));
        return;
      }

      var action = button.getAttribute("data-editor-action");
      if (action === "link") createLink();
      if (action === "unlink") exec("unlink");
      if (action === "image" && typeof config.onImage === "function") config.onImage();
    });

    var block = $("editorBlockSelect");
    if (block) {
      block.addEventListener("pointerdown", saveSelection);
      block.addEventListener("change", function () {
        var value = this.value;
        if (value === "blockquote") exec("formatBlock", "blockquote");
        else exec("formatBlock", value || "p");
        this.value = "";
      });
    }

    var font = $("editorFontSelect");
    if (font) {
      font.addEventListener("pointerdown", saveSelection);
      font.addEventListener("change", function () {
        if (this.value) exec("fontName", this.value);
        this.value = "";
      });
    }

    var size = $("editorFontSizeSelect");
    if (size) {
      size.addEventListener("pointerdown", saveSelection);
      size.addEventListener("change", function () {
        if (this.value) exec("fontSize", this.value);
        this.value = "";
      });
    }

    var spacing = $("editorLineHeightSelect");
    if (spacing) {
      spacing.addEventListener("pointerdown", saveSelection);
      spacing.addEventListener("change", function () {
        if (this.value) applyLineHeight(this.value);
        this.value = "";
      });
    }

    var color = $("editorTextColor");
    if (color) {
      color.addEventListener("pointerdown", saveSelection);
      color.addEventListener("input", function () {
        exec("foreColor", this.value);
      });
    }

    var highlight = $("editorHighlightColor");
    if (highlight) {
      highlight.addEventListener("pointerdown", saveSelection);
      highlight.addEventListener("input", function () {
        exec("hiliteColor", this.value);
      });
    }
  }

  function init(options) {
    config = options || {};
    editor = $(config.editorId || "storyBodyEditor");
    toolbar = $(config.toolbarId || "writerToolbar");
    if (!editor || !toolbar) return;

    wireToolbar();

    document.addEventListener("selectionchange", function () {
      var selection = window.getSelection();
      if (!selection || !selection.anchorNode) return;
      if (isInsideEditor(selection.anchorNode)) {
        saveSelection();
        syncButtons();
      }
    });

    editor.addEventListener("input", markChanged);
    editor.addEventListener("keyup", saveSelection);
    editor.addEventListener("mouseup", saveSelection);

    editor.addEventListener("paste", function (event) {
      event.preventDefault();
      var clipboard = event.clipboardData;
      var html = clipboard && clipboard.getData("text/html");
      var text = clipboard && clipboard.getData("text/plain");

      restoreSelection();
      if (html && window.ThoughtsRichContent) {
        var stored = window.ThoughtsRichContent.forStorage(html);
        var display = window.ThoughtsRichContent.forDisplay(
          stored,
          config.mediaEndpoint || ""
        );
        document.execCommand("insertHTML", false, display);
      } else {
        document.execCommand("insertText", false, text || "");
      }
      markChanged();
    });

    editor.addEventListener("keydown", function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (typeof config.onSave === "function") config.onSave();
      }
    });
  }

  function setContent(html) {
    if (!editor) return;
    var display = window.ThoughtsRichContent
      ? window.ThoughtsRichContent.forDisplay(html || "", config.mediaEndpoint || "")
      : String(html || "");
    editor.innerHTML = display;
    lastRange = null;
  }

  function getContent() {
    if (!editor) return "";
    return window.ThoughtsRichContent
      ? window.ThoughtsRichContent.forStorage(editor.innerHTML)
      : editor.innerHTML;
  }

  window.ThoughtsEditor = {
    init: init,
    setContent: setContent,
    getContent: getContent,
    insertMedia: insertMedia,
    focus: function () {
      if (editor) editor.focus();
    },
  };
})();
