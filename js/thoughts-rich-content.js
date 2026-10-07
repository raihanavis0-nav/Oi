(function () {
  "use strict";

  var ALLOWED_TAGS = new Set([
    "P", "DIV", "BR", "H2", "H3", "H4", "STRONG", "B", "EM", "I", "U",
    "S", "STRIKE", "BLOCKQUOTE", "UL", "OL", "LI", "A", "IMG", "FIGURE",
    "FIGCAPTION", "SPAN", "SUB", "SUP", "HR", "PRE", "CODE", "FONT"
  ]);

  var DROP_TAGS = new Set([
    "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "FORM", "INPUT", "BUTTON",
    "TEXTAREA", "SELECT", "OPTION", "SVG", "MATH", "META", "LINK"
  ]);

  var FONT_FAMILIES = new Set([
    "Newsreader",
    "Inter",
    "EB Garamond",
    "Lora",
    "Merriweather",
    "Playfair Display",
    "Space Grotesk",
    "Georgia",
    "Arial",
    "Times New Roman"
  ]);

  function safeUrl(value, allowMediaPath) {
    var url = String(value || "").trim();
    if (!url) return "";
    if (allowMediaPath && /^assets\/thoughts\/[a-z0-9_./-]+$/i.test(url)) return url;
    if (/^https?:\/\//i.test(url)) return url;
    if (/^mailto:/i.test(url)) return url;
    if (/^#/.test(url)) return url;
    if (/^(\.\.?\/|\/)/.test(url) && !/^\/\//.test(url)) return url;
    return "";
  }

  function validColor(value) {
    var probe = document.createElement("span");
    probe.style.color = "";
    probe.style.color = String(value || "");
    return probe.style.color || "";
  }

  function cleanStyle(styleText) {
    var probe = document.createElement("span");
    probe.setAttribute("style", String(styleText || ""));
    var out = [];

    var font = String(probe.style.fontFamily || "")
      .replace(/["']/g, "")
      .split(",")[0]
      .trim();
    if (FONT_FAMILIES.has(font)) out.push("font-family: " + font);

    var size = String(probe.style.fontSize || "").trim().toLowerCase();
    if (
      /^(?:[8-9]|[1-6][0-9]|7[0-2])px$/i.test(size) ||
      /^(?:0\.[6-9]|[1-3](?:\.\d+)?)em$/i.test(size) ||
      /^(?:0\.[6-9]|[1-3](?:\.\d+)?)rem$/i.test(size) ||
      /^(?:[6-9][0-9]|[12][0-9]{2})%$/i.test(size) ||
      /^(?:xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger)$/i.test(size)
    ) {
      out.push("font-size: " + size);
    }

    var weight = String(probe.style.fontWeight || "").trim().toLowerCase();
    if (/^(?:normal|bold|[1-9]00)$/.test(weight)) out.push("font-weight: " + weight);

    var fontStyle = String(probe.style.fontStyle || "").trim().toLowerCase();
    if (["normal", "italic", "oblique"].includes(fontStyle)) out.push("font-style: " + fontStyle);

    var decoration = String(probe.style.textDecorationLine || "").trim().toLowerCase();
    if (decoration) {
      var allowedDecoration = decoration
        .split(/\s+/)
        .filter(function (part) {
          return ["underline", "line-through", "overline"].includes(part);
        })
        .join(" ");
      if (allowedDecoration) out.push("text-decoration-line: " + allowedDecoration);
    }

    var vertical = String(probe.style.verticalAlign || "").trim().toLowerCase();
    if (["baseline", "sub", "super"].includes(vertical)) out.push("vertical-align: " + vertical);

    var color = validColor(probe.style.color);
    if (color) out.push("color: " + color);

    var background = validColor(probe.style.backgroundColor);
    if (background) out.push("background-color: " + background);

    var align = String(probe.style.textAlign || "").trim().toLowerCase();
    if (["left", "center", "right", "justify"].includes(align)) out.push("text-align: " + align);

    var lineHeight = String(probe.style.lineHeight || "").trim().toLowerCase();
    if (lineHeight === "normal" || /^(?:1|1\.[0-9]|2(?:\.0)?)$/.test(lineHeight)) {
      out.push("line-height: " + lineHeight);
    }

    var marginLeft = String(probe.style.marginLeft || "").trim().toLowerCase();
    if (/^(?:0|(?:[1-9]|[1-9][0-9]|1[0-9]{2})px|(?:0\.[1-9]|[1-6](?:\.\d+)?)em|(?:0\.[1-9]|[1-6](?:\.\d+)?)rem)$/.test(marginLeft)) {
      out.push("margin-left: " + marginLeft);
    }

    return out.join("; ");
  }

  function mediaPathFromSrc(src) {
    var value = String(src || "").trim();
    if (/^assets\/thoughts\/[a-z0-9_./-]+$/i.test(value)) return value;

    try {
      var url = new URL(value, window.location.href);
      if (/\/api\/thoughts(?:-admin)?\/media$/i.test(url.pathname)) {
        var path = url.searchParams.get("path") || "";
        if (/^assets\/thoughts\/[a-z0-9_./-]+$/i.test(path)) return path;
      }
    } catch (_) {}

    return "";
  }

  function sanitize(html, options) {
    options = options || {};
    var forStorage = options.forStorage === true;
    var mediaEndpoint = String(options.mediaEndpoint || "");
    var template = document.createElement("template");
    template.innerHTML = String(html || "");

    function walk(parent) {
      Array.from(parent.childNodes).forEach(function (node) {
        if (node.nodeType === Node.COMMENT_NODE) {
          node.remove();
          return;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) return;

        var tag = node.tagName.toUpperCase();
        if (!ALLOWED_TAGS.has(tag)) {
          if (DROP_TAGS.has(tag)) {
            node.remove();
          } else {
            var fragment = document.createDocumentFragment();
            while (node.firstChild) fragment.appendChild(node.firstChild);
            node.replaceWith(fragment);
            walk(parent);
          }
          return;
        }

        var original = {};
        Array.from(node.attributes).forEach(function (attr) {
          original[attr.name.toLowerCase()] = attr.value;
          node.removeAttribute(attr.name);
        });

        var style = cleanStyle(original.style || "");
        if (style && tag !== "IMG") node.setAttribute("style", style);

        if (tag === "FONT") {
          var face = String(original.face || "").replace(/["']/g, "").split(",")[0].trim();
          if (FONT_FAMILIES.has(face)) node.setAttribute("face", face);
          if (/^[1-7]$/.test(String(original.size || ""))) node.setAttribute("size", String(original.size));
          var fontColor = validColor(original.color);
          if (fontColor) node.setAttribute("color", fontColor);
        }

        if (tag === "A") {
          var href = safeUrl(original.href, false);
          if (href) {
            node.setAttribute("href", href);
            if (/^https?:\/\//i.test(href)) {
              node.setAttribute("target", "_blank");
              node.setAttribute("rel", "noopener noreferrer");
            }
          }
        }

        if (tag === "IMG") {
          var mediaPath = String(original["data-media-path"] || "").trim() || mediaPathFromSrc(original.src);
          var src = "";

          if (mediaPath && /^assets\/thoughts\/[a-z0-9_./-]+$/i.test(mediaPath)) {
            node.setAttribute("data-media-path", mediaPath);
            src = forStorage
              ? mediaPath
              : mediaEndpoint + "?path=" + encodeURIComponent(mediaPath);
          } else {
            src = safeUrl(original.src, false);
          }

          if (!src || (!/^https?:\/\//i.test(src) && !/^assets\/thoughts\//i.test(src) && src.indexOf(mediaEndpoint + "?path=") !== 0)) {
            node.remove();
            return;
          }

          node.setAttribute("src", src);
          node.setAttribute("alt", String(original.alt || "").slice(0, 300));
          node.setAttribute("loading", "lazy");
        }

        walk(node);
      });
    }

    walk(template.content);
    return template.innerHTML;
  }

  function forStorage(html) {
    return sanitize(html, { forStorage: true });
  }

  function forDisplay(html, mediaEndpoint) {
    return sanitize(html, {
      forStorage: false,
      mediaEndpoint: mediaEndpoint || "",
    });
  }

  window.ThoughtsRichContent = {
    forStorage: forStorage,
    forDisplay: forDisplay,
  };
})();
