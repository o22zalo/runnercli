const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawnSync } = require("child_process");
const { runTailscaleCli } = require("./tailscale/acl-service");

const CREATE_TUNNEL_MODE_SET = new Set(["create-tunnel", "createtunnel", "tunnel"]);
const TAILSCALE_MODE_SET = new Set(["tailscale", "acl", "access-controls"]);
const PATCH_ENV_MODE_SET = new Set(["patch-env", "patchenv", "env-patch"]);

async function runCli(rawArgs, options = {}) {
  const args = Array.isArray(rawArgs) ? [...rawArgs] : [];
  const scriptName = (options.scriptName || path.basename(process.argv[1] || "")).toLowerCase();
  const firstArg = (args[0] || "").toLowerCase();
  const createTunnelModeFromArg = CREATE_TUNNEL_MODE_SET.has(firstArg);
  const createTunnelModeFromCommandName = scriptName.includes("createtunnel");
  const tailscaleModeFromArg = TAILSCALE_MODE_SET.has(firstArg);
  const tailscaleModeFromCommandName = scriptName.includes("tailscale");
  const patchEnvModeFromArg = PATCH_ENV_MODE_SET.has(firstArg);
  const patchEnvModeFromCommandName = scriptName.includes("patch-env") || scriptName.includes("patchenv");

  if (createTunnelModeFromArg || tailscaleModeFromArg || patchEnvModeFromArg) {
    args.shift();
  }

  if (createTunnelModeFromArg || createTunnelModeFromCommandName) {
    await runCreateTunnelCli(args);
    return;
  }

  if (tailscaleModeFromArg || tailscaleModeFromCommandName) {
    await runTailscaleCli(args);
    return;
  }

  if (patchEnvModeFromArg || patchEnvModeFromCommandName) {
    runPatchEnvCli(args);
    return;
  }

  throw new Error("unknown CLI mode. Use runnerCLI, runnerCLI-createtunnel, runnerCLI-tailscale, or runnerCLI-patch-env.");
}

async function runCreateTunnelCli(rawArgs) {
  const parsed = parseCreateTunnelArgs(rawArgs);

  if (parsed.help) {
    printCreateTunnelHelp();
    return;
  }

  if (parsed.errors.length > 0) {
    for (const message of parsed.errors) {
      console.error(`error: ${message}`);
    }
    console.error("");
    printCreateTunnelHelp();
    process.exit(1);
  }

  const config = collectTunnelConfig(process.env);

  console.log("runnerCLI-createtunnel");
  console.log(`working directory: ${process.cwd()}`);
  console.log("");

  if (config.emptyNameKeys.length > 0) {
    console.log("warning: empty tunnel-name variable(s), ignored:");
    for (const key of config.emptyNameKeys) {
      console.log(`- ${key}`);
    }
    console.log("");
  }

  if (config.ignoredNameKeys.length > 0) {
    console.log("warning: ignored prefixed tunnel-name variable(s) because CLOUDFLARED_TUNNEL_NAME is set:");
    for (const key of config.ignoredNameKeys) {
      console.log(`- ${key}`);
    }
    console.log("");
  }

  if (config.emptyDomainKeys.length > 0) {
    console.log("warning: empty domain variable(s), ignored:");
    for (const key of config.emptyDomainKeys) {
      console.log(`- ${key}`);
    }
    console.log("");
  }

  if (config.errors.length > 0) {
    console.error("invalid tunnel configuration:");
    for (const error of config.errors) {
      console.error(`- ${error}`);
    }
    console.error("");
    console.error(
      "expected one tunnel name and at least one domain. Example: CLOUDFLARED_TUNNEL_NAME + CLOUDFLARED_TUNNEL_DOMAIN_00, CLOUDFLARED_TUNNEL_DOMAIN_01.",
    );
    process.exit(1);
  }

  console.log(`tunnel name: "${config.tunnelName}"`);
  console.log(`dns record(s): ${config.domains.length}`);
  for (const item of config.domains) {
    console.log(`- [${item.suffix}] ${item.domain}`);
  }
  console.log("");

  if (!parsed.autoYes) {
    const approved = await askForConfirmation(`Create tunnel "${config.tunnelName}" and route ${config.domains.length} DNS record(s)? (yes/no): `);
    if (!approved) {
      console.log("cancelled by user.");
      return;
    }
  } else {
    console.log("auto-confirm enabled by --yes");
  }

  const result = createSingleTunnelWithManyDns(config);

  if (result.configFilePath) {
    console.log(`config written: ${result.configFilePath}`);
  }
  if (result.credentialsFilePath) {
    console.log(`credentials written: ${result.credentialsFilePath}`);
  }

  console.log("");
  console.log(`summary: tunnel_created=${result.tunnelCreated ? 1 : 0}, dns_success=${result.dnsSuccess}, dns_failed=${result.dnsFailed}`);
  if (result.dnsFailed > 0) {
    process.exit(1);
  }
}

function parseCreateTunnelArgs(rawArgs) {
  const args = Array.isArray(rawArgs) ? rawArgs : [];
  const output = {
    autoYes: false,
    help: false,
    errors: [],
  };

  for (const item of args) {
    const value = String(item || "").trim();
    if (!value) {
      continue;
    }

    if (value === "--yes" || value === "-y") {
      output.autoYes = true;
      continue;
    }

    if (value === "--help" || value === "-h") {
      output.help = true;
      continue;
    }

    output.errors.push(`unknown argument: ${value}`);
  }

  return output;
}

function printCreateTunnelHelp() {
  console.log("runnerCLI-createtunnel");
  console.log("Usage:");
  console.log("  runnerCLI-createtunnel [--yes]");
  console.log("");
  console.log("Options:");
  console.log("  --yes, -y   Skip confirmation prompt");
  console.log("  --help, -h  Show this help");
  console.log("");
  console.log("Required env:");
  console.log("  CLOUDFLARED_TUNNEL_NAME or one unique CLOUDFLARED_TUNNEL_NAME_XX");
  console.log("  CLOUDFLARED_TUNNEL_DOMAIN_00 (and optional _01, _02, ...)");
  console.log("");
  console.log("Optional env:");
  console.log("  SSH_PORT                    Default: 2222");
  console.log("  CLOUDFLARED_DEFAULT_SERVICE Default: http://127.0.0.1:80");
}

function runPatchEnvCli(rawArgs) {
  const parsed = parsePatchEnvArgs(rawArgs);

  if (parsed.help) {
    printPatchEnvHelp();
    return;
  }

  if (parsed.errors.length > 0) {
    for (const message of parsed.errors) {
      console.error(`error: ${message}`);
    }
    console.error("");
    printPatchEnvHelp();
    process.exit(1);
  }

  if (!parsed.envFile) {
    console.error("missing .env file argument.");
    console.error("");
    printPatchEnvHelp();
    process.exit(1);
  }

  const envFilePath = path.resolve(process.cwd(), parsed.envFile);

  console.log("runnerCLI-patch-env");
  console.log(`working directory: ${process.cwd()}`);
  console.log(`env file: ${envFilePath}`);
  console.log(`mode: ${parsed.dryRun ? "dry-run" : "write"}`);
  console.log("");

  if (!fs.existsSync(envFilePath)) {
    console.error(`env file not found: ${envFilePath}`);
    process.exit(1);
  }

  let rawContent = "";
  try {
    rawContent = fs.readFileSync(envFilePath, "utf8");
  } catch (error) {
    console.error(`failed to read env file: ${error.message}`);
    process.exit(1);
  }

  const newline = rawContent.includes("\r\n") ? "\r\n" : "\n";
  const lines = rawContent.split(/\r?\n/g);
  const envDir = path.dirname(envFilePath);

  const warnings = [];
  let skipped = 0;
  let failed = 0;
  let pending = null;
  let updated = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] || "");
    const pathMatch = line.match(/^\s*#\s*Path:\s*(.*?)\s*$/i);
    if (pathMatch) {
      const rawPath = normalizePatchEnvPathFromComment(pathMatch[1]);
      if (!rawPath) {
        warnings.push(`warning: empty # Path value at line ${index + 1}`);
        pending = null;
        continue;
      }

      if (pending) {
        warnings.push(`warning: unused # Path at line ${pending.commentLine} overwritten by new # Path at line ${index + 1}`);
      }

      pending = { rawPath, commentLine: index + 1 };
      continue;
    }

    if (!pending) {
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("#")) {
      continue;
    }

    const assignment = parseEnvAssignmentLineForPatch(line);
    if (!assignment) {
      warnings.push(`warning: expected env assignment after # Path at line ${pending.commentLine}, got line ${index + 1}`);
      pending = null;
      continue;
    }

    if (!assignment.key.toUpperCase().endsWith("_BASE64")) {
      warnings.push(`warning: skipped ${assignment.key} at line ${index + 1} (expected *_BASE64 key)`);
      skipped += 1;
      pending = null;
      continue;
    }

    const sourcePath = resolvePatchEnvSourcePath(pending.rawPath, envDir);
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      console.error(
        `error: source file not found for ${assignment.key} (declared at # Path line ${pending.commentLine}): ${sourcePath || pending.rawPath}`,
      );
      failed += 1;
      pending = null;
      continue;
    }

    let fileBuffer;
    try {
      fileBuffer = fs.readFileSync(sourcePath);
    } catch (error) {
      console.error(`error: cannot read source file for ${assignment.key}: ${sourcePath} (${error.message})`);
      failed += 1;
      pending = null;
      continue;
    }

    const base64Value = fileBuffer.toString("base64");
    lines[index] = `${assignment.prefix}${base64Value}${assignment.spaceBeforeComment}${assignment.comment}`;
    updated += 1;

    console.log(`update: ${assignment.key}`);
    console.log(`  from: ${pending.rawPath}`);
    console.log(`  file: ${sourcePath}`);
    console.log(`  bytes: ${fileBuffer.length}, base64: ${base64Value.length}`);
    pending = null;
  }

  if (pending) {
    warnings.push(`warning: unused # Path at line ${pending.commentLine} (no env assignment found after it)`);
  }

  if (warnings.length > 0) {
    console.log("");
    for (const message of warnings) {
      console.log(message);
    }
  }

  const patchedContent = lines.join(newline);
  if (parsed.dryRun) {
    console.log("");
    console.log("dry-run: no file written.");
  } else {
    try {
      fs.writeFileSync(envFilePath, patchedContent, "utf8");
      console.log("");
      console.log("env patched.");
    } catch (error) {
      console.error(`failed to write env file: ${error.message}`);
      process.exit(1);
    }
  }

  console.log(`summary: updated=${updated}, skipped=${skipped}, failed=${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
}

function parsePatchEnvArgs(rawArgs) {
  const args = Array.isArray(rawArgs) ? rawArgs : [];
  const output = {
    envFile: "",
    dryRun: false,
    help: false,
    errors: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const value = String(args[index] || "").trim();
    if (!value) {
      continue;
    }

    if (value === "--help" || value === "-h") {
      output.help = true;
      continue;
    }

    if (value === "--dry-run") {
      output.dryRun = true;
      continue;
    }

    if (value === "--file" || value === "-f" || value === "--env-file" || value === "--env") {
      const next = String(args[index + 1] || "").trim();
      if (!next) {
        output.errors.push(`missing value for ${value}`);
      } else {
        output.envFile = next;
        index += 1;
      }
      continue;
    }

    if (value.startsWith("-")) {
      output.errors.push(`unknown option: ${value}`);
      continue;
    }

    if (!output.envFile) {
      output.envFile = value;
      continue;
    }

    output.errors.push(`unexpected argument: ${value}`);
  }

  return output;
}

function printPatchEnvHelp() {
  console.log("runnerCLI-patch-env");
  console.log("Usage:");
  console.log("  runnerCLI-patch-env <path-to-.env>");
  console.log("  runnerCLI-patch-env --file <path-to-.env>");
  console.log("");
  console.log("Options:");
  console.log("  --dry-run   Print updates without writing file");
  console.log("  --help, -h  Show this help");
  console.log("");
  console.log("Behavior:");
  console.log("  - Scans .env for lines like `# Path: ./some-file`");
  console.log("  - Base64 encodes the referenced file content and writes it into the next *_BASE64 env key");
  console.log("");
  console.log("Example:");
  console.log("  # Path: ./cloudflared-config.yml");
  console.log("  CLOUDFLARED_CONFIG_YML_BASE64=");
}

function normalizePatchEnvPathFromComment(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  const withoutHint = trimmed.includes("=>") ? trimmed.split("=>")[0].trim() : trimmed;
  const unquoted =
    (withoutHint.startsWith('"') && withoutHint.endsWith('"')) || (withoutHint.startsWith("'") && withoutHint.endsWith("'"))
      ? withoutHint.slice(1, -1)
      : withoutHint;

  return String(unquoted || "").trim();
}

function resolvePatchEnvSourcePath(rawPath, envDir) {
  const cleaned = normalizePatchEnvPathFromComment(rawPath);
  if (!cleaned) {
    return "";
  }

  if (cleaned === "~") {
    return os.homedir();
  }

  if (cleaned.startsWith("~/")) {
    return path.join(os.homedir(), cleaned.slice(2));
  }

  if (path.isAbsolute(cleaned)) {
    return cleaned;
  }

  return path.resolve(envDir, cleaned);
}

function parseEnvAssignmentLineForPatch(line) {
  const text = String(line || "");
  const keyMatch = text.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  if (!keyMatch) {
    return null;
  }

  const key = keyMatch[1];
  const eqIndex = text.indexOf("=");
  if (eqIndex < 0) {
    return null;
  }

  let prefixEnd = eqIndex + 1;
  while (prefixEnd < text.length && (text[prefixEnd] === " " || text[prefixEnd] === "\t")) {
    prefixEnd += 1;
  }

  const prefix = text.slice(0, prefixEnd);
  const afterEq = text.slice(prefixEnd);

  const commentMatch = afterEq.match(/(^|[\t ])#/);
  let comment = "";
  let spaceBeforeComment = "";
  if (commentMatch) {
    const hashIndex = commentMatch.index + commentMatch[0].length - 1;
    comment = afterEq.slice(hashIndex);
    const beforeHash = afterEq.slice(0, hashIndex);
    const trailingSpace = beforeHash.match(/[ \t]*$/);
    spaceBeforeComment = trailingSpace ? trailingSpace[0] : "";
  }

  return {
    key,
    prefix,
    comment,
    spaceBeforeComment,
  };
}

function collectTunnelConfig(env) {
  const namePrefix = "CLOUDFLARED_TUNNEL_NAME_";
  const domainPrefix = "CLOUDFLARED_TUNNEL_DOMAIN_";
  const singleNameKey = "CLOUDFLARED_TUNNEL_NAME";
  const singleNameValue = normalizeEnvValue(env[singleNameKey]);
  const prefixNameEntries = [];
  const ignoredNameKeys = [];
  const domainsBySuffix = new Map();
  const emptyNameKeys = [];
  const emptyDomainKeys = [];

  for (const [key, value] of Object.entries(env)) {
    const normalizedValue = normalizeEnvValue(value);
    if (key === singleNameKey) {
      if (!normalizedValue) {
        emptyNameKeys.push(key);
      }
      continue;
    }

    if (key.startsWith(namePrefix)) {
      if (normalizedValue) {
        prefixNameEntries.push({
          key,
          suffix: key.slice(namePrefix.length),
          name: normalizedValue,
        });
      } else {
        emptyNameKeys.push(key);
      }
      continue;
    }

    if (key.startsWith(domainPrefix)) {
      const suffix = key.slice(domainPrefix.length);
      if (normalizedValue) {
        domainsBySuffix.set(suffix, normalizedValue);
      } else {
        emptyDomainKeys.push(key);
      }
    }
  }

  const domains = Array.from(domainsBySuffix.entries())
    .map(([suffix, domain]) => ({ suffix, domain }))
    .sort((left, right) =>
      left.suffix.localeCompare(right.suffix, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );

  const uniquePrefixNames = Array.from(new Set(prefixNameEntries.map((item) => item.name)));
  const errors = [];
  let tunnelName = "";

  if (singleNameValue) {
    tunnelName = singleNameValue;
    for (const entry of prefixNameEntries) {
      if (entry.name !== tunnelName) {
        ignoredNameKeys.push(entry.key);
      }
    }
  } else if (uniquePrefixNames.length === 1) {
    tunnelName = uniquePrefixNames[0];
  } else if (uniquePrefixNames.length > 1) {
    const sources = prefixNameEntries.map((item) => `${item.key}=${item.name}`).join(", ");
    errors.push(`found multiple prefixed tunnel names. Only one tunnel is allowed. Current values: ${sources}`);
  }

  if (!tunnelName && uniquePrefixNames.length === 0) {
    errors.push("missing tunnel name. Set CLOUDFLARED_TUNNEL_NAME, or set one unique value in CLOUDFLARED_TUNNEL_NAME_00.");
  }

  if (domains.length === 0) {
    errors.push("missing domain list. Set at least one variable with prefix CLOUDFLARED_TUNNEL_DOMAIN_.");
  }

  return {
    tunnelName,
    domains,
    errors,
    emptyNameKeys,
    emptyDomainKeys,
    ignoredNameKeys,
  };
}

function createSingleTunnelWithManyDns(config) {
  const credentialSearchDirs = getCredentialSearchDirectories();
  const beforeCreate = snapshotCredentialFiles(credentialSearchDirs);
  const existingTunnelInfo = getTunnelInfoByName(config.tunnelName);
  const tunnelAlreadyExists = Boolean(existingTunnelInfo.tunnelId);

  console.log("");
  if (tunnelAlreadyExists) {
    console.log(`create tunnel: "${config.tunnelName}"`);
    console.log("info: tunnel already exists from tunnel list, skipping create.");
  } else {
    console.log(`create tunnel: "${config.tunnelName}"`);
  }

  let createOutput = "";
  let tunnelCreated = false;
  if (!tunnelAlreadyExists) {
    const createResult = runCommand("cloudflared", ["tunnel", "create", config.tunnelName], { allowFailure: true });
    createOutput = combineCommandOutput(createResult);

    if (createResult.status === 0) {
      tunnelCreated = true;
    } else if (isTunnelAlreadyExistsOutput(createOutput)) {
      console.log("info: tunnel already exists, treating as success.");
    } else {
      throw new Error(`failed to create tunnel "${config.tunnelName}" and it does not look like an existing-tunnel case`);
    }
  }

  const tunnelInfo = tunnelAlreadyExists ? existingTunnelInfo : getTunnelInfoByName(config.tunnelName);
  const tunnelIdFromOutput = extractTunnelIdFromText(createOutput);
  const tunnelId = tunnelInfo.tunnelId || tunnelIdFromOutput;

  const credentialPath = resolveCredentialPath({
    commandOutput: createOutput,
    searchDirs: credentialSearchDirs,
    beforeSnapshot: beforeCreate,
    tunnelId,
  });

  let credentialData = credentialPath ? readCredentialJson(credentialPath) : null;
  let tunnelToken = "";

  if (!credentialData) {
    console.log("warning: credentials .json not found from local files, trying cloudflared tunnel token API fallback.");
    tunnelToken = fetchTunnelTokenFromApi(config.tunnelName);
    credentialData = buildDefaultCredentialContent(tunnelId, tunnelToken);
  }

  const resolvedTunnelId = tunnelId || String(credentialData.TunnelID || "").trim();
  const tunnelRef = resolvedTunnelId || config.tunnelName;

  let dnsSuccess = 0;
  let dnsFailed = 0;

  for (let index = 0; index < config.domains.length; index += 1) {
    const domainItem = config.domains[index];
    console.log("");
    console.log(`[dns ${index + 1}/${config.domains.length}] tunnel="${config.tunnelName}" domain="${domainItem.domain}"`);
    const routeResult = runCommand("cloudflared", ["tunnel", "route", "dns", config.tunnelName, domainItem.domain], { allowFailure: true });
    if (routeResult.status === 0) {
      dnsSuccess += 1;
      continue;
    }

    if (isDnsAlreadyExistsOutput(combineCommandOutput(routeResult))) {
      console.log(`info: dns record already exists for ${domainItem.domain}, treating as success.`);
      dnsSuccess += 1;
      continue;
    }

    dnsFailed += 1;
    console.error(`failed dns route [${domainItem.suffix}] ${domainItem.domain}: command returned non-zero status`);
  }

  const configOutput = writeCloudflaredConfigFile({
    tunnel: tunnelRef,
    domains: config.domains.map((item) => item.domain),
    sshPort: parseSshPort(process.env.SSH_PORT),
    defaultService: normalizeEnvValue(process.env.CLOUDFLARED_DEFAULT_SERVICE) || "http://127.0.0.1:80",
  });

  const credentialOutput = writeEnrichedCredentialFile({
    credentialData,
    config,
    tunnelId: resolvedTunnelId,
    tunnelRef,
    sourcePath: credentialPath || "",
    configOutput,
    tunnelToken,
  });

  console.log(`credentials source: ${credentialPath || "not found locally (used fallback content)"}`);
  console.log(`config output: ${configOutput.filePath}`);

  return {
    tunnelCreated,
    dnsSuccess,
    dnsFailed,
    configFilePath: configOutput.filePath,
    credentialsFilePath: credentialOutput.filePath,
  };
}

function runCommand(command, args, options = {}) {
  const allowFailure = options.allowFailure === true;
  console.log(`$ ${command} ${args.map(quoteArgForLog).join(" ")}`);
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
  });

  if (result.error) {
    throw new Error(`command failed to start: ${result.error.message} (${command})`);
  }

  if (result.stdout && result.stdout.trim()) {
    console.log("stdout:");
    console.log(result.stdout.trimEnd());
  }
  if (result.stderr && result.stderr.trim()) {
    console.log("stderr:");
    console.log(result.stderr.trimEnd());
  }

  const exitCode = result.status === null ? "unknown" : String(result.status);
  console.log(`exit: ${exitCode}`);

  if (result.status !== 0 && !allowFailure) {
    throw new Error(`command exited with non-zero status (${exitCode}): ${command} ${args.join(" ")}`);
  }

  return result;
}

function combineCommandOutput(result) {
  return `${String(result.stdout || "")}\n${String(result.stderr || "")}`.trim();
}

function isTunnelAlreadyExistsOutput(output) {
  const normalized = String(output || "").toLowerCase();
  return (
    normalized.includes("already exists") ||
    normalized.includes("already been created") ||
    normalized.includes("tunnel with this name already exists") ||
    normalized.includes("same tunnel")
  );
}

function isDnsAlreadyExistsOutput(output) {
  const normalized = String(output || "").toLowerCase();
  return (
    normalized.includes("already exists") ||
    normalized.includes("already configured") ||
    normalized.includes("record with that host already exists") ||
    normalized.includes("conflict")
  );
}

function getCredentialSearchDirectories() {
  const dirs = new Set();
  const homeDir = os.homedir();

  if (homeDir) {
    dirs.add(path.join(homeDir, ".cloudflared"));
  }
  if (process.env.HOME) {
    dirs.add(path.join(process.env.HOME, ".cloudflared"));
  }
  if (process.env.USERPROFILE) {
    dirs.add(path.join(process.env.USERPROFILE, ".cloudflared"));
  }
  if (process.env.CLOUDFLARED_HOME) {
    dirs.add(process.env.CLOUDFLARED_HOME);
  }
  if (process.env.CLOUDFLARED_CONFIG) {
    const configPath = process.env.CLOUDFLARED_CONFIG;
    const isYamlFile = configPath.endsWith(".yml") || configPath.endsWith(".yaml");
    dirs.add(isYamlFile ? path.dirname(configPath) : configPath);
  }
  dirs.add(process.cwd());

  return Array.from(dirs);
}

function snapshotCredentialFiles(directories) {
  const snapshot = new Map();

  for (const directory of directories) {
    if (!directory || !fs.existsSync(directory)) {
      continue;
    }

    try {
      const entries = fs.readdirSync(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) {
          continue;
        }
        const fullPath = path.join(directory, entry.name);
        const stat = fs.statSync(fullPath);
        snapshot.set(fullPath, stat.mtimeMs);
      }
    } catch (error) {
      console.log(`warning: cannot inspect directory "${directory}": ${error.message}`);
    }
  }

  return snapshot;
}

function resolveCredentialPath({ commandOutput, searchDirs, beforeSnapshot, tunnelId }) {
  const pathsFromOutput = extractJsonPathsFromText(commandOutput).filter((item) => fs.existsSync(item));
  for (const candidate of pathsFromOutput) {
    if (looksLikeCredentialJson(candidate)) {
      return candidate;
    }
  }

  const afterSnapshot = snapshotCredentialFiles(searchDirs);
  const changedCandidates = [];
  for (const [filePath, mtime] of afterSnapshot.entries()) {
    const beforeMtime = beforeSnapshot.get(filePath);
    if (beforeMtime === undefined || mtime > beforeMtime + 1) {
      changedCandidates.push({ filePath, mtime });
    }
  }
  changedCandidates.sort((left, right) => right.mtime - left.mtime);

  for (const candidate of changedCandidates) {
    if (looksLikeCredentialJson(candidate.filePath)) {
      return candidate.filePath;
    }
  }

  for (const candidate of changedCandidates) {
    if (fs.existsSync(candidate.filePath)) {
      return candidate.filePath;
    }
  }

  if (tunnelId) {
    for (const directory of searchDirs) {
      const candidate = path.join(directory, `${tunnelId}.json`);
      if (fs.existsSync(candidate) && looksLikeCredentialJson(candidate)) {
        return candidate;
      }
    }
  }

  if (tunnelId) {
    const allFiles = snapshotCredentialFiles(searchDirs);
    for (const filePath of allFiles.keys()) {
      const parsed = readCredentialJson(filePath);
      if (!parsed) {
        continue;
      }
      if (String(parsed.TunnelID || "").trim() === tunnelId) {
        return filePath;
      }
    }
  }

  const cwdCredentialPath = path.join(process.cwd(), "cloudflared-credentials.json");
  if (fs.existsSync(cwdCredentialPath) && looksLikeCredentialJson(cwdCredentialPath)) {
    return cwdCredentialPath;
  }

  return null;
}

function extractJsonPathsFromText(text) {
  const pathRegex = /([A-Za-z]:\\[^\r\n"]*?\.json|\/[^\r\n"]*?\.json|~\/[^\r\n"]*?\.json)/g;
  const quoteRegex = /["']([^"']+\.json)["']/g;
  const result = new Set();

  for (const match of text.matchAll(pathRegex)) {
    result.add(cleanPathCandidate(match[1]));
  }
  for (const match of text.matchAll(quoteRegex)) {
    result.add(cleanPathCandidate(match[1]));
  }

  return Array.from(result)
    .map((item) => {
      if (item.startsWith("~/")) {
        return path.join(os.homedir(), item.slice(2));
      }
      return item;
    })
    .filter(Boolean);
}

function cleanPathCandidate(value) {
  return String(value || "")
    .trim()
    .replace(/[`"'()]+/g, "")
    .replace(/[.,;:]+$/, "");
}

function looksLikeCredentialJson(filePath) {
  try {
    const rawContent = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(rawContent);
    return parsed && typeof parsed === "object" && "TunnelID" in parsed && "TunnelSecret" in parsed;
  } catch (error) {
    return false;
  }
}

function readCredentialJson(filePath) {
  try {
    const rawContent = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(rawContent);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch (error) {
    return null;
  }
}

function getTunnelInfoByName(tunnelName) {
  const listJsonResult = runCommand("cloudflared", ["tunnel", "list", "--output", "json"], { allowFailure: true });
  if (listJsonResult.status === 0) {
    try {
      const parsed = JSON.parse(listJsonResult.stdout || "[]");
      if (Array.isArray(parsed)) {
        const found = parsed.find((item) => {
          const name = String(item.Name || item.name || item.TunnelName || "").trim();
          return name === tunnelName;
        });
        if (found) {
          const tunnelId = String(found.ID || found.id || found.TunnelID || found.tunnelId || "").trim();
          return {
            tunnelId,
          };
        }
      }
    } catch (error) {
      console.log("warning: cannot parse `cloudflared tunnel list --output json`.");
    }
  }

  const infoResult = runCommand("cloudflared", ["tunnel", "info", tunnelName], { allowFailure: true });
  if (infoResult.status === 0) {
    const tunnelId = extractTunnelIdFromText(combineCommandOutput(infoResult));
    return {
      tunnelId,
    };
  }

  return {
    tunnelId: "",
  };
}

function extractTunnelIdFromText(text) {
  const match = String(text || "").match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
  return match ? match[0].toLowerCase() : "";
}

function buildDefaultCredentialContent(tunnelId, tunnelToken) {
  const data = {
    AccountTag: "",
    TunnelSecret: "",
    TunnelID: String(tunnelId || "").trim(),
    Endpoint: "",
  };
  if (tunnelToken) {
    data.TunnelToken = tunnelToken;
  }
  return data;
}

function fetchTunnelTokenFromApi(tunnelName) {
  const tokenResult = runCommand("cloudflared", ["tunnel", "token", tunnelName], { allowFailure: true });
  if (tokenResult.status !== 0) {
    return "";
  }

  const output = combineCommandOutput(tokenResult);
  const match = output.match(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/);
  if (match) {
    return match[0];
  }

  const nonEmptyLines = output
    .split(/\r?\n/g)
    .map((item) => item.trim())
    .filter(Boolean);
  return nonEmptyLines.length > 0 ? nonEmptyLines[0] : "";
}

function writeCloudflaredConfigFile(options) {
  const tunnel = String(options.tunnel || "").trim();
  const domains = Array.isArray(options.domains) ? options.domains : [];
  const sshPort = options.sshPort;
  const defaultService = options.defaultService;
  const lines = [`tunnel: ${tunnel}`, "credentials-file: /etc/cloudflared/credentials.json", "", "ingress:"];

  let hasSshComment = false;
  for (const domain of domains) {
    const hostname = String(domain || "").trim();
    if (!hostname) {
      continue;
    }
    const service = serviceForDomain(hostname, sshPort, defaultService);
    if (service.startsWith("ssh://") && !hasSshComment) {
      lines.push("  # SSH over Cloudflare Tunnel (requires DNS record + Cloudflare Access policy).");
      hasSshComment = true;
    }
    lines.push(`  - hostname: ${hostname}`);
    lines.push(`    service: ${service}`);
  }
  lines.push("  - service: http_status:404");
  lines.push("");

  const content = lines.join("\n");
  const filePath = path.join(process.cwd(), "cloudflared-config.yml");
  fs.writeFileSync(filePath, content, "utf8");

  return {
    filePath,
    content,
  };
}

function serviceForDomain(hostname, sshPort, defaultService) {
  if (hostname.toLowerCase().startsWith("ssh")) {
    return `ssh://127.0.0.1:${sshPort}`;
  }
  return defaultService;
}

function parseSshPort(rawValue) {
  const normalized = normalizeEnvValue(rawValue);
  if (!normalized) {
    return 2222;
  }
  const asNumber = Number(normalized);
  if (!Number.isInteger(asNumber) || asNumber <= 0 || asNumber > 65535) {
    return 2222;
  }
  return asNumber;
}

function writeEnrichedCredentialFile(options) {
  const credentialData = options.credentialData && typeof options.credentialData === "object" ? options.credentialData : {};
  const config = options.config;
  const sourcePath = String(options.sourcePath || "");
  const tunnelToken = String(options.tunnelToken || "");
  const configOutput = options.configOutput || { filePath: "", content: "" };
  const tunnelRef = String(options.tunnelRef || options.config.tunnelName || "");
  const tunnelId = String(options.tunnelId || credentialData.TunnelID || "");
  const baseCredential = buildDefaultCredentialContent(tunnelId, tunnelToken);

  const payloadWithoutBase64 = {
    ...baseCredential,
    ...credentialData,
    TunnelID: tunnelId,
    tunnel_name: config.tunnelName,
    tunnel_ref: tunnelRef,
    tunnul_domain: config.domains.length > 0 ? config.domains[0].domain : "",
    tunnul_domains: config.domains.map((item) => item.domain),
    cloudflared_config_yml: configOutput.content,
    cloudflared_config_file: path.basename(configOutput.filePath || ""),
    source_credentials_file: sourcePath,
  };

  const serializedWithoutBase64 = `${JSON.stringify(payloadWithoutBase64, null, 2)}\n`;
  const output = {
    ...payloadWithoutBase64,
    base64: Buffer.from(serializedWithoutBase64, "utf8").toString("base64"),
  };

  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  const defaultOutputPath = path.join(process.cwd(), "cloudflared-credentials.json");
  fs.writeFileSync(defaultOutputPath, serialized, "utf8");

  return {
    filePath: defaultOutputPath,
  };
}

function normalizeEnvValue(value) {
  return String(value || "").trim();
}

function quoteArgForLog(value) {
  if (/^[a-zA-Z0-9._:/\\-]+$/.test(value)) {
    return value;
  }
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

async function askForConfirmation(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const normalized = String(answer || "")
        .trim()
        .toLowerCase();
      resolve(normalized === "y" || normalized === "yes");
    });
  });
}

if (require.main === module) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(`fatal: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  runCli,
  runCreateTunnelCli,
  runPatchEnvCli,
};
