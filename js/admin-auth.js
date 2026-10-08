(function () {
  "use strict";

  var endpoint = "/api/admin-auth";
  var scripts = [
    "js/thoughts-rich-content.js",
    "js/thoughts-editor.js",
    "js/thoughts-admin.js",
    "js/thoughts-editor-bridge.js",
    "js/thoughts-character-groups.js",
  ];
  var started = false;

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(message, isError) {
    var node = $("adminAuthStatus");
    if (!node) return;
    node.textContent = message || "";
    node.classList.toggle("is-error", Boolean(isError));
  }

  function showLogin(message) {
    var gate = $("adminAuthGate");
    var app = $("adminApp");
    if (app) app.hidden = true;
    if (gate) gate.hidden = false;
    setStatus(message || "", Boolean(message));

    var input = $("adminPasswordInput");
    if (input) {
      input.value = "";
      window.setTimeout(function () {
        input.focus();
      }, 0);
    }
  }

  function hideLogin() {
    var gate = $("adminAuthGate");
    if (gate) gate.hidden = true;
  }

  function request(method, body) {
    return fetch(endpoint, {
      method: method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (response) {
      return response.json().catch(function () {
        return {};
      }).then(function (payload) {
        if (!response.ok) {
          var error = new Error(payload.error || "Request failed.");
          error.status = response.status;
          throw error;
        }
        return payload;
      });
    });
  }

  function loadScript(index) {
    if (index >= scripts.length) return Promise.resolve();

    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = scripts[index];
      script.async = false;
      script.onload = function () {
        resolve(loadScript(index + 1));
      };
      script.onerror = function () {
        reject(new Error("Could not load the admin application."));
      };
      document.head.appendChild(script);
    });
  }

  function startAdmin() {
    if (started) return Promise.resolve();
    started = true;
    hideLogin();

    return loadScript(0).catch(function (error) {
      started = false;
      showLogin(error.message);
      throw error;
    });
  }

  function checkSession() {
    setStatus("Checking access…", false);

    request("GET").then(function (result) {
      if (!result.configured) {
        showLogin("THOUGHTS_ACCESS_CODE must be set in Vercel (minimum 4 characters).");
        return;
      }

      if (result.authenticated) {
        setStatus("", false);
        startAdmin();
        return;
      }

      showLogin("");
    }).catch(function () {
      showLogin("Could not verify admin access.");
    });
  }

  function submit(event) {
    event.preventDefault();

    var input = $("adminPasswordInput");
    var button = $("adminLoginButton");
    var password = input ? input.value : "";

    if (!password) {
      setStatus("Enter the password.", true);
      if (input) input.focus();
      return;
    }

    if (button) button.disabled = true;
    setStatus("Checking…", false);

    request("POST", { password: password }).then(function () {
      if (input) input.value = "";
      setStatus("", false);
      return startAdmin();
    }).catch(function (error) {
      showLogin(error.message || "Could not sign in.");
    }).finally(function () {
      if (button) button.disabled = false;
    });
  }

  function init() {
    var form = $("adminAuthForm");
    if (form) form.addEventListener("submit", submit);
    checkSession();
  }

  window.archiveAdminAuth = {
    showLogin: showLogin,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
