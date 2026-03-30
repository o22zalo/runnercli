const fs = require("fs");
const path = require("path");
const { createTailscaleApiClient, TailscaleApiError } = require("./api-client");

const DEFAULT_ACTION = "access-controls";
const DEFAULT_TAILNET = "-";
const DEFAULT_BODY_FILENAME = "access-controls.hujson";
const DEFAULT_API_BASE_URL = "https://api.tailscale.com";
const DEFAULT_TIMEOUT_MS = 30000;

const ACTION_HANDLERS = {
  "access-controls": executeAccessControlsAction,
  acl: executeAccessControlsAction,
};

async function runTailscaleCli(rawArgs) {
  const args = Array.isArray(rawArgs) ? [...rawArgs] : [];
  const parsed = parseCliArgs(args);

  if (parsed.showHelp) {
    printHelp();
    return;
  }

  if (parsed.errors.length > 0) {
    console.error("invalid arguments:");
    for (const error of parsed.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  const envConfig = collectEnvConfig(process.env);
  const authErrors = validateAuthConfig(envConfig);
  if (authErrors.length > 0) {
    console.error("missing tailscale authentication env:");
    for (const error of authErrors) {
      console.error(`- ${error}`);
    }
    console.error("");
    console.error("required:");
    console.error("- TAILSCALE_CLIENT_ID + TAILSCALE_CLIENT_SECRET (or TS_CLIENT_ID + TS_CLIENT_SECRET)");
    process.exit(1);
  }

  const action = normalizeAction(parsed.action || DEFAULT_ACTION);
  const actionHandler = ACTION_HANDLERS[action];
  if (!actionHandler) {
    console.error(`unknown action: ${parsed.action}`);
    console.error(`supported actions: ${Object.keys(ACTION_HANDLERS).join(", ")}`);
    process.exit(1);
  }

  const bodyPathResult = resolveAclBodyFile(parsed.bodyFile || envConfig.aclBodyFile);
  if (!bodyPathResult.ok) {
    console.error(`missing ACL body file: ${bodyPathResult.message}`);
    process.exit(1);
  }

  let aclBody = "";
  try {
    aclBody = fs.readFileSync(bodyPathResult.path, "utf8").trim();
  } catch (error) {
    console.error(`cannot read ACL body file "${bodyPathResult.path}": ${error.message}`);
    process.exit(1);
  }

  if (!aclBody) {
    console.error(`ACL body file is empty: ${bodyPathResult.path}`);
    process.exit(1);
  }

  const tailnet = String(parsed.tailnet || envConfig.tailnet || DEFAULT_TAILNET).trim() || DEFAULT_TAILNET;
  const client = createTailscaleApiClient({
    baseUrl: envConfig.apiBaseUrl || DEFAULT_API_BASE_URL,
    timeoutMs: envConfig.timeoutMs || DEFAULT_TIMEOUT_MS,
  });

  console.log("runnerCLI-tailscale");
  console.log(`action: ${action}`);
  console.log(`api base url: ${client.baseUrl}`);
  console.log(`tailnet: ${tailnet}`);
  console.log(`body file: ${bodyPathResult.path}`);
  console.log(`auth mode: ${describeAuthMode(envConfig)}`);

  if (parsed.dryRun) {
    console.log("");
    console.log("dry-run: env and config validated, no API call was sent.");
    return;
  }

  try {
    const response = await actionHandler({
      client,
      envConfig,
      tailnet,
      aclBody,
    });

    console.log("");
    console.log(`status: ${response.statusCode}`);
    const bodySummary = summarizeBody(response.body);
    if (bodySummary) {
      console.log(`response: ${bodySummary}`);
    }
    console.log("summary: access_controls_updated=1");
  } catch (error) {
    console.error(`fatal: ${formatError(error)}`);
    process.exit(1);
  }
}

async function executeAccessControlsAction(context) {
  const { client, envConfig, tailnet, aclBody } = context;
  console.log("");
  console.log("apply acl: requesting OAuth access token from client credentials.");
  return updateAclWithOAuthToken(client, envConfig, tailnet, aclBody);
}

async function updateAclWithOAuthToken(client, envConfig, tailnet, aclBody) {
  if (!envConfig.clientId || !envConfig.clientSecret) {
    throw new Error("cannot request OAuth access token because client credentials are missing.");
  }

  const tokenResult = await client.fetchOAuthToken({
    clientId: envConfig.clientId,
    clientSecret: envConfig.clientSecret,
    scope: envConfig.oauthScope,
  });

  console.log("oauth token acquired. applying access controls with bearer token.");

  return client.updateAccessControls({
    tailnet,
    aclBody,
    auth: {
      type: "bearer",
      token: tokenResult.accessToken,
    },
  });
}

function parseCliArgs(args) {
  const parsed = {
    action: DEFAULT_ACTION,
    tailnet: "",
    bodyFile: "",
    dryRun: false,
    showHelp: false,
    errors: [],
    positionalActionSet: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || "").trim();
    if (!arg) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      parsed.showHelp = true;
      continue;
    }

    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    if (!arg.startsWith("-") && !parsed.positionalActionSet) {
      parsed.action = arg;
      parsed.positionalActionSet = true;
      continue;
    }

    if (arg.startsWith("--action=")) {
      parsed.action = arg.slice("--action=".length).trim();
      continue;
    }
    if (arg === "--action") {
      const value = readOptionValue(args, index + 1);
      if (!value.ok) {
        parsed.errors.push("--action requires a value");
      } else {
        parsed.action = value.value;
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--tailnet=")) {
      parsed.tailnet = arg.slice("--tailnet=".length).trim();
      continue;
    }
    if (arg === "--tailnet") {
      const value = readOptionValue(args, index + 1);
      if (!value.ok) {
        parsed.errors.push("--tailnet requires a value");
      } else {
        parsed.tailnet = value.value;
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--body-file=")) {
      parsed.bodyFile = arg.slice("--body-file=".length).trim();
      continue;
    }
    if (arg === "--body-file") {
      const value = readOptionValue(args, index + 1);
      if (!value.ok) {
        parsed.errors.push("--body-file requires a value");
      } else {
        parsed.bodyFile = value.value;
        index += 1;
      }
      continue;
    }

    parsed.errors.push(`unknown argument: ${arg}`);
  }

  delete parsed.positionalActionSet;
  return parsed;
}

function readOptionValue(args, index) {
  const candidate = String(args[index] || "").trim();
  if (!candidate || candidate.startsWith("-")) {
    return { ok: false, value: "" };
  }
  return { ok: true, value: candidate };
}

function collectEnvConfig(env) {
  return {
    clientId: firstNonEmpty([env.TAILSCALE_CLIENT_ID, env.TS_CLIENT_ID]),
    clientSecret: firstNonEmpty([env.TAILSCALE_CLIENT_SECRET, env.TS_CLIENT_SECRET]),
    oauthScope: firstNonEmpty([env.TAILSCALE_OAUTH_SCOPE]),
    tailnet: firstNonEmpty([env.TAILSCALE_TAILNET]),
    aclBodyFile: firstNonEmpty([env.TAILSCALE_ACL_BODY_FILE]),
    apiBaseUrl: firstNonEmpty([env.TAILSCALE_API_BASE_URL]) || DEFAULT_API_BASE_URL,
    timeoutMs: parsePositiveInteger(firstNonEmpty([env.TAILSCALE_API_TIMEOUT_MS])) || DEFAULT_TIMEOUT_MS,
  };
}

function validateAuthConfig(config) {
  const errors = [];

  if (!config.clientId && !config.clientSecret) {
    errors.push("missing TAILSCALE_CLIENT_ID and TAILSCALE_CLIENT_SECRET");
    return errors;
  }

  if (!config.clientId) {
    errors.push("missing TAILSCALE_CLIENT_ID (or TS_CLIENT_ID)");
  }
  if (!config.clientSecret) {
    errors.push("missing TAILSCALE_CLIENT_SECRET (or TS_CLIENT_SECRET)");
  }

  return errors;
}

function resolveAclBodyFile(explicitFile) {
  const requested = String(explicitFile || "").trim();

  if (requested) {
    const resolved = path.isAbsolute(requested) ? requested : path.resolve(process.cwd(), requested);
    if (isReadableFile(resolved)) {
      return { ok: true, path: resolved };
    }
    return {
      ok: false,
      path: "",
      message: `file not found: ${resolved}`,
    };
  }

  const cwdCandidates = [path.resolve(process.cwd(), "tailscale", DEFAULT_BODY_FILENAME), path.resolve(process.cwd(), "tailscale-acl.hujson")];

  for (const candidate of cwdCandidates) {
    if (isReadableFile(candidate)) {
      return { ok: true, path: candidate };
    }
  }

  const bundled = path.join(__dirname, DEFAULT_BODY_FILENAME);
  if (isReadableFile(bundled)) {
    return { ok: true, path: bundled };
  }

  return {
    ok: false,
    path: "",
    message: "cannot find ACL body file in cwd or bundled defaults",
  };
}

function describeAuthMode(config) {
  if (config.clientId && config.clientSecret) {
    return "oauth-client-credentials";
  }
  return "none";
}

function normalizeAction(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function firstNonEmpty(values) {
  for (const item of values) {
    const normalized = String(item || "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return 0;
}

function summarizeBody(text) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return "";
  }

  try {
    const parsed = JSON.parse(normalized);
    return truncate(JSON.stringify(parsed));
  } catch (error) {
    return truncate(normalized.replace(/\s+/g, " "));
  }
}

function truncate(text, maxLength = 320) {
  const normalized = String(text || "");
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function formatError(error) {
  if (error instanceof TailscaleApiError) {
    const summary = summarizeBody(error.responseBody);
    const statusPart = error.statusCode ? `status ${error.statusCode}` : "request failed";
    return summary ? `${statusPart} - ${summary}` : statusPart;
  }
  return String(error && error.message ? error.message : error);
}

function isReadableFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile();
  } catch (error) {
    return false;
  }
}

function printHelp() {
  console.log("runnerCLI-tailscale");
  console.log("Usage:");
  console.log("  runnerCLI-tailscale [action] [--tailnet <name>] [--body-file <path>] [--dry-run]");
  console.log("");
  console.log("Actions:");
  console.log("  access-controls, acl   Update Access Controls ACL on Tailscale");
  console.log("");
  console.log("Options:");
  console.log("  --tailnet <name>       Tailnet slug/domain. Default: -");
  console.log("  --body-file <path>     Path to hujson ACL body file");
  console.log("  --dry-run              Validate env and body only, do not call API");
  console.log("  --help, -h             Show this help");
  console.log("");
  console.log("Env auth priority:");
  console.log("  1) TAILSCALE_CLIENT_ID + TAILSCALE_CLIENT_SECRET (or TS_* aliases)");
}

module.exports = {
  runTailscaleCli,
};
