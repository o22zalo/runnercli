#!/usr/bin/env node

const readline = require("readline");
const { runCli } = require("./cli-core");

const COMMANDS = [
  {
    key: "1",
    aliases: ["createtunnel", "create-tunnel", "tunnel", "runnerCLI-createtunnel"],
    name: "runnerCLI-createtunnel",
    description: "Create Cloudflare tunnel and DNS records from env",
    argsPrefix: ["create-tunnel"],
  },
  {
    key: "2",
    aliases: ["tailscale", "acl", "access-controls", "runnerCLI-tailscale"],
    name: "runnerCLI-tailscale",
    description: "Update Tailscale Access Controls from hujson body",
    argsPrefix: ["tailscale"],
  },
  {
    key: "3",
    aliases: ["patch-env", "patchenv", "env-patch", "runnerCLI-patch-env"],
    name: "runnerCLI-patch-env",
    description: "Patch .env by base64-encoding files referenced by '# Path:' comments",
    argsPrefix: ["patch-env"],
  },
];

async function runMain(rawArgs) {
  const args = Array.isArray(rawArgs) ? [...rawArgs] : [];
  const firstArg = String(args[0] || "").trim();

  if (firstArg === "--help" || firstArg === "-h") {
    printHelp();
    return;
  }

  if (firstArg) {
    const selected = findCommand(firstArg);
    if (!selected) {
      console.error(`invalid command selector: ${firstArg}`);
      printMenu();
      process.exit(1);
    }
    await executeCommand(selected, args.slice(1));
    return;
  }

  const selectionInput = await askInteractiveSelection();
  const parts = splitInput(selectionInput);
  if (parts.length === 0) {
    console.log("cancelled.");
    return;
  }

  const selected = findCommand(parts[0]);
  if (!selected) {
    console.error(`invalid selection: ${parts[0]}`);
    process.exit(1);
  }

  await executeCommand(selected, parts.slice(1));
}

function findCommand(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (!normalized || normalized === "q" || normalized === "quit" || normalized === "exit" || normalized === "0") {
    return null;
  }

  return COMMANDS.find((item) => item.key === normalized || item.aliases.includes(normalized)) || null;
}

async function executeCommand(command, extraArgs) {
  const forwardedArgs = Array.isArray(extraArgs) ? extraArgs : [];
  console.log(`selected: ${command.name}`);
  console.log("");
  await runCli([...command.argsPrefix, ...forwardedArgs], {
    scriptName: "runnerCLI",
  });
}

function askInteractiveSelection() {
  printMenu();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question("Select command number (or type q to exit): ", (answer) => {
      rl.close();
      resolve(String(answer || "").trim());
    });
  });
}

function splitInput(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return [];
  }
  if (["q", "quit", "exit", "0"].includes(normalized.toLowerCase())) {
    return [];
  }
  return normalized.split(/\s+/g).filter(Boolean);
}

function printMenu() {
  console.log("runnerCLI");
  console.log("Available CLI commands:");
  for (const item of COMMANDS) {
    console.log(`${item.key}. ${item.name} - ${item.description}`);
  }
  console.log("0. Exit");
  console.log("");
}

function printHelp() {
  printMenu();
  console.log("Usage:");
  console.log("  runnerCLI");
  console.log("  runnerCLI <selector> [args...]");
  console.log("");
  console.log("Selectors:");
  console.log("  1 | createtunnel | create-tunnel | runnerCLI-createtunnel");
  console.log("  2 | tailscale | acl | access-controls | runnerCLI-tailscale");
  console.log("  3 | patch-env | patchenv | env-patch | runnerCLI-patch-env");
  console.log("");
  console.log("Examples:");
  console.log("  runnerCLI");
  console.log("  runnerCLI 1 --yes");
  console.log("  runnerCLI 2 --dry-run");
  console.log("  runnerCLI 3 .env --dry-run");
}

if (require.main === module) {
  runMain(process.argv.slice(2)).catch((error) => {
    console.error(`fatal: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  runMain,
};
