(function () {
  "use strict";

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function looksLikeRichHtml(value) {
    return /<(?:p|div|h[2-4]|blockquote|ul|ol|li|figure|span|strong|em|u|s|br|pre)\b/i.test(
      String(value || "")
    );
  }

  function inlineMarkdown(source) {
    var text = escapeHtml(source || "");
    text = text
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/(^|[^_])_([^_]+)_/g, "$1<em>$2</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");

    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, function (_, label, url) {
      return '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + label + "</a>";
    });

    return text;
  }

  function markdownToHtml(source) {
    var lines = String(source || "").replace(/\r\n?/g, "\n").split("\n");
    var out = [];
    var paragraph = [];
    var listType = "";
    var listItems = [];
    var quote = [];

    function flushParagraph() {
      if (!paragraph.length) return;
      out.push("<p>" + inlineMarkdown(paragraph.join(" ")) + "</p>");
      paragraph = [];
    }

    function flushList() {
      if (!listItems.length || !listType) return;
      out.push(
        "<" + listType + ">" +
          listItems.map(function (item) {
            return "<li>" + inlineMarkdown(item) + "</li>";
          }).join("") +
        "</" + listType + ">"
      );
      listItems = [];
      listType = "";
    }

    function flushQuote() {
      if (!quote.length) return;
      out.push("<blockquote><p>" + inlineMarkdown(quote.join(" ")) + "</p></blockquote>");
      quote = [];
    }

    lines.forEach(function (line) {
      if (!line.trim()) {
        flushParagraph();
        flushList();
        flushQuote();
        return;
      }

      var image = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (image) {
        flushParagraph();
        flushList();
        flushQuote();
        var path = image[2];
        if (/^assets\/thoughts\//i.test(path)) {
          out.push(
            '<figure><img data-media-path="' + escapeHtml(path) + '" src="' + escapeHtml(path) + '" alt="' + escapeHtml(image[1]) + '"><figcaption>' + escapeHtml(image[1]) + "</figcaption></figure>"
          );
        }
        return;
      }

      var heading = line.match(/^(#{2,3})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        flushList();
        flushQuote();
        out.push("<h" + heading[1].length + ">" + inlineMarkdown(heading[2]) + "</h" + heading[1].length + ">");
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
        if (listType && listType !== "ul") flushList();
        listType = "ul";
        listItems.push(unordered[1]);
        return;
      }

      var ordered = line.match(/^\d+\.\s+(.+)$/);
      if (ordered) {
        flushParagraph();
        flushQuote();
        if (listType && listType !== "ol") flushList();
        listType = "ol";
        listItems.push(ordered[1]);
        return;
      }

      flushList();
      flushQuote();
      paragraph.push(line.trim());
    });

    flushParagraph();
    flushList();
    flushQuote();
    return out.join("\n");
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
      var maxWidth = 1600;
      if (width > maxWidth) {
        height = Math.round(height * (maxWidth / width));
        width = maxWidth;
      }

      var canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(image, 0, 0, width, height);

      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) {
          if (blob) {
            resolve({ blob: blob, ext: "webp" });
            return;
          }
          canvas.toBlob(function (jpg) {
            resolve({ blob: jpg, ext: "jpg" });
          }, "image/jpeg", 0.84);
        }, "image/webp", 0.82);
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

  function uploadImage(file) {
    return compressImage(file).then(function (result) {
      if (!result.blob) throw new Error("Could not compress the image.");
      return blobToBase64(result.blob).then(function (content) {
        return fetch("/api/thoughts-admin/upload", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            filename: file.name.replace(/\.[^.]+$/, ""),
            extension: result.ext,
            content: content,
          }),
        }).then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (body) {
            if (!response.ok) throw new Error(body.error || "Upload failed.");
            return body;
          });
        });
      });
    });
  }

  function init() {
    if (!window.ThoughtsEditor || !$("storyBodyInput") || !$("storyBodyEditor")) return;

    var legacy = $("storyBodyInput");
    var workspace = $("storyWorkspace");
    var imageInput = $("richStoryImageInput");
    var indicator = $("saveIndicator");
    var syncing = false;

    function syncToLegacy() {
      if (syncing) return;
      legacy.value = window.ThoughtsEditor.getContent();
      legacy.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function syncFromLegacy() {
      syncing = true;
      var source = legacy.value || "";
      var html = looksLikeRichHtml(source) ? source : markdownToHtml(source);
      window.ThoughtsEditor.setContent(html);
      syncing = false;
    }

    window.ThoughtsEditor.init({
      editorId: "storyBodyEditor",
      toolbarId: "writerToolbar",
      mediaEndpoint: "/api/thoughts-admin/media",
      onChange: syncToLegacy,
      onSave: function () {
        syncToLegacy();
        $("saveStoryBtn").click();
      },
      onImage: function () {
        imageInput.click();
      },
    });

    var observer = new MutationObserver(function () {
      if (!workspace.hidden) {
        window.setTimeout(syncFromLegacy, 0);
      }
    });
    observer.observe(workspace, { attributes: true, attributeFilter: ["hidden"] });

    imageInput.addEventListener("change", function () {
      var file = imageInput.files && imageInput.files[0];
      if (!file) return;
      indicator.textContent = "Uploading image…";
      indicator.classList.add("is-saving");

      uploadImage(file)
        .then(function (result) {
          window.ThoughtsEditor.insertMedia(result.path, file.name.replace(/\.[^.]+$/, ""));
          imageInput.value = "";
          indicator.textContent = "Unsaved";
          indicator.classList.remove("is-saving");
        })
        .catch(function (error) {
          imageInput.value = "";
          indicator.textContent = "Upload failed";
          indicator.classList.remove("is-saving");
          indicator.classList.add("is-error");
          window.alert(error.message);
        });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
