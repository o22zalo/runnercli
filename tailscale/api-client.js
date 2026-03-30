const https = require("https");
const { URL, URLSearchParams } = require("url");

const DEFAULT_BASE_URL = "https://api.tailscale.com";
const DEFAULT_TIMEOUT_MS = 30000;

class TailscaleApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "TailscaleApiError";
    this.statusCode = Number(options.statusCode || 0);
    this.responseBody = String(options.responseBody || "");
    this.responseHeaders = options.responseHeaders || {};
    this.request = options.request || null;
  }
}

function createTailscaleApiClient(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl || DEFAULT_BASE_URL);
  const defaultTimeoutMs = normalizeTimeout(options.timeoutMs, DEFAULT_TIMEOUT_MS);

  async function request(input = {}) {
    const method = String(input.method || "GET")
      .trim()
      .toUpperCase();
    const requestPath = normalizeRequestPath(input.path || "/");
    const body = input.body === undefined || input.body === null ? "" : String(input.body);
    const headers = cloneHeaders(input.headers);
    const timeoutMs = normalizeTimeout(input.timeoutMs, defaultTimeoutMs);

    if (!hasHeader(headers, "accept")) {
      headers.Accept = "application/json";
    }
    if (body && !hasHeader(headers, "content-length")) {
      headers["Content-Length"] = String(Buffer.byteLength(body, "utf8"));
    }

    applyAuthHeader(headers, input.auth);

    return sendHttpRequest({
      endpoint: new URL(requestPath, `${baseUrl}/`),
      method,
      headers,
      body,
      timeoutMs,
    });
  }

  async function updateAccessControls(options = {}) {
    const tailnet = normalizeTailnet(options.tailnet || "-");
    const aclBody = String(options.aclBody || "").trim();

    if (!aclBody) {
      throw new Error("ACL body is empty. Provide non-empty hujson content.");
    }

    return request({
      method: "POST",
      path: `/api/v2/tailnet/${encodeURIComponent(tailnet)}/acl`,
      headers: {
        "Content-Type": "application/hujson",
      },
      body: aclBody,
      auth: options.auth,
      timeoutMs: options.timeoutMs,
    });
  }

  async function fetchOAuthToken(options = {}) {
    const clientId = String(options.clientId || "").trim();
    const clientSecret = String(options.clientSecret || "").trim();
    const scope = String(options.scope || "").trim();

    if (!clientId || !clientSecret) {
      throw new Error("Missing OAuth client credentials.");
    }

    const formBody = new URLSearchParams({
      grant_type: "client_credentials",
    });
    if (scope) {
      formBody.set("scope", scope);
    }

    const response = await request({
      method: "POST",
      path: "/api/v2/oauth/token",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody.toString(),
      auth: {
        type: "basic",
        clientId,
        clientSecret,
      },
      timeoutMs: options.timeoutMs,
    });

    let parsed;
    try {
      parsed = JSON.parse(response.body || "{}");
    } catch (error) {
      throw new Error("OAuth token response is not valid JSON.");
    }

    const accessToken = String(parsed.access_token || "").trim();
    if (!accessToken) {
      throw new Error("OAuth token response does not contain access_token.");
    }

    return {
      accessToken,
      tokenType: String(parsed.token_type || "bearer"),
      expiresIn: Number(parsed.expires_in || 0),
      raw: parsed,
    };
  }

  return {
    baseUrl,
    request,
    updateAccessControls,
    fetchOAuthToken,
  };
}

function sendHttpRequest(options) {
  const endpoint = options.endpoint;
  const method = options.method;
  const headers = options.headers || {};
  const body = String(options.body || "");
  const timeoutMs = normalizeTimeout(options.timeoutMs, DEFAULT_TIMEOUT_MS);

  return new Promise((resolve, reject) => {
    const req = https.request(
      endpoint,
      {
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString("utf8");
          const statusCode = Number(res.statusCode || 0);
          const response = {
            statusCode,
            headers: res.headers || {},
            body: responseBody,
            ok: statusCode >= 200 && statusCode < 300,
          };

          if (response.ok) {
            resolve(response);
            return;
          }

          reject(
            new TailscaleApiError(`Tailscale API request failed (${statusCode})`, {
              statusCode,
              responseBody,
              responseHeaders: response.headers,
              request: {
                method,
                path: `${endpoint.pathname}${endpoint.search}`,
              },
            }),
          );
        });
      },
    );

    req.on("error", (error) => {
      reject(new Error(`Tailscale API network error: ${error.message}`));
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`request timeout after ${timeoutMs}ms`));
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function applyAuthHeader(headers, auth) {
  if (!auth || typeof auth !== "object") {
    return;
  }

  if (String(auth.type || "").toLowerCase() === "basic") {
    const clientId = String(auth.clientId || "").trim();
    const clientSecret = String(auth.clientSecret || "").trim();
    if (!clientId || !clientSecret) {
      throw new Error("Basic auth requires clientId and clientSecret.");
    }
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
    return;
  }

  if (String(auth.type || "").toLowerCase() === "bearer") {
    const token = String(auth.token || "").trim();
    if (!token) {
      throw new Error("Bearer auth requires token.");
    }
    headers.Authorization = `Bearer ${token}`;
  }
}

function normalizeBaseUrl(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/\/+$/, "");

  if (!normalized) {
    return DEFAULT_BASE_URL;
  }

  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error(`Invalid Tailscale API base URL: ${normalized}`);
  }

  return normalized;
}

function normalizeTimeout(value, fallback) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function normalizeRequestPath(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "/";
  }
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function normalizeTailnet(value) {
  const normalized = String(value || "").trim();
  return normalized || "-";
}

function cloneHeaders(input) {
  if (!input || typeof input !== "object") {
    return {};
  }
  return { ...input };
}

function hasHeader(headers, expectedName) {
  const normalizedExpected = String(expectedName || "")
    .trim()
    .toLowerCase();
  if (!normalizedExpected) {
    return false;
  }
  return Object.keys(headers).some((key) => key.toLowerCase() === normalizedExpected);
}

module.exports = {
  createTailscaleApiClient,
  TailscaleApiError,
};
