const OWNER = "alfathxxxxyz";
const REPO = "copy";
const DATA_BRANCH = "thoughts-data";
const DATA_PATH = "content/thoughts.json";
const API_ROOT = "https://api.github.com/repos/" + OWNER + "/" + REPO;

function githubToken() {
  return process.env.THOUGHTS_GITHUB_TOKEN || "";
}

function isConfigured() {
  return Boolean(githubToken());
}

function headers() {
  return {
    Authorization: "Bearer " + githubToken(),
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

async function githubJson(url, options) {
  if (!isConfigured()) {
    const error = new Error("GitHub storage is not configured.");
    error.status = 503;
    throw error;
  }

  const response = await fetch(
    url,
    Object.assign({}, options || {}, {
      headers: Object.assign({}, headers(), (options && options.headers) || {}),
    })
  );

  if (!response.ok) {
    const detail = await response.text();
    const error = new Error("GitHub request failed (" + response.status + ").");
    error.status = response.status;
    error.detail = detail;
    throw error;
  }

  return response.json();
}

function contentUrl(path) {
  return API_ROOT + "/contents/" + String(path || "").split("/").map(encodeURIComponent).join("/");
}

async function getFile(path) {
  return githubJson(
    contentUrl(path) + "?ref=" + encodeURIComponent(DATA_BRANCH)
  );
}

async function getRawFile(path) {
  if (!isConfigured()) {
    const error = new Error("GitHub storage is not configured.");
    error.status = 503;
    throw error;
  }

  const response = await fetch(
    contentUrl(path) + "?ref=" + encodeURIComponent(DATA_BRANCH),
    {
      headers: {
        Authorization: "Bearer " + githubToken(),
        Accept: "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    const error = new Error("GitHub media request failed (" + response.status + ").");
    error.status = response.status;
    error.detail = detail;
    throw error;
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "application/octet-stream",
  };
}

async function readLibrary() {
  const file = await getFile(DATA_PATH);
  const text = Buffer.from(
    String(file.content || "").replace(/\n/g, ""),
    "base64"
  ).toString("utf8");

  return {
    sha: file.sha,
    data: JSON.parse(text),
  };
}

async function writeLibrary(data, message, expectedSha) {
  const latest = await getFile(DATA_PATH);

  if (expectedSha && latest.sha !== expectedSha) {
    const error = new Error("Stories library changed in another session.");
    error.status = 409;
    error.currentSha = latest.sha;
    throw error;
  }

  const content = Buffer.from(
    JSON.stringify(data, null, 2) + "\n",
    "utf8"
  ).toString("base64");

  return githubJson(contentUrl(DATA_PATH), {
    method: "PUT",
    body: JSON.stringify({
      message: String(message || "stories: update library")
        .replace(/[\r\n]+/g, " ")
        .slice(0, 120),
      content: content,
      branch: DATA_BRANCH,
      sha: latest.sha,
    }),
  });
}

async function writeMedia(path, base64Content, message) {
  return githubJson(contentUrl(path), {
    method: "PUT",
    body: JSON.stringify({
      message: String(message || "stories: upload media")
        .replace(/[\r\n]+/g, " ")
        .slice(0, 120),
      content: base64Content,
      branch: DATA_BRANCH,
    }),
  });
}

module.exports = {
  DATA_BRANCH,
  DATA_PATH,
  getFile,
  getRawFile,
  isConfigured,
  readLibrary,
  writeLibrary,
  writeMedia,
};
