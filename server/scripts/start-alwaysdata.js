const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { startProduction, cleanWallet } = require("./start-production");

function configureAlwaysdata(binding = { host: process.env.IP || process.env.HOST, port: process.env.PORT }) {
  const home = os.userInfo().homedir;
  if (process.platform !== "linux" || !/^\/home\/[^/]+$/.test(home)) {
    throw new Error("Use this launcher on your alwaysdata Linux account with a home directory under /home.");
  }
  if (!binding.host || !/^\d+$/.test(binding.port || "") || Number(binding.port) < 1 || Number(binding.port) > 65535) {
    throw new Error("Start this app through an alwaysdata Node.js site so its assigned IP/HOST and PORT are provided.");
  }

  const storage = path.join(home, "anhs-vote-data");
  const database = process.env.DB_PATH || path.join(storage, "data.sqlite");
  if (!path.isAbsolute(database) || path.dirname(database) !== storage) {
    throw new Error(`DB_PATH must be an absolute file path directly inside ${storage}. Remove a copied Windows or Docker DB_PATH.`);
  }
  fs.mkdirSync(storage, { recursive: true, mode: 0o700 });
  if (fs.realpathSync(storage) !== path.join(fs.realpathSync(home), "anhs-vote-data") ||
      (fs.existsSync(database) && path.dirname(fs.realpathSync(database)) !== fs.realpathSync(storage))) {
    throw new Error("The alwaysdata storage directory and database must not link outside the account's data directory.");
  }
  fs.accessSync(storage, fs.constants.R_OK | fs.constants.W_OK);

  Object.assign(process.env, {
    NODE_ENV: "production", HOST: binding.host, PORT: binding.port,
    STORAGE_PATH: storage, DB_PATH: database,
    // alwaysdata persists the account's files; this directory is not a Docker mount.
    // Its location and write access are checked above before using the shared launcher.
    REQUIRE_PERSISTENT_STORAGE: "false",
  });
}

function startAlwaysdata() {
  // Capture the platform binding before loading a privately uploaded local config.
  const binding = { host: process.env.IP || process.env.HOST, port: process.env.PORT };
  require("dotenv").config({ path: path.join(__dirname, "../.env"), quiet: true });
  configureAlwaysdata(binding);
  return startProduction();
}

if (require.main === module) {
  process.on("exit", cleanWallet);
  try { startAlwaysdata(); }
  catch (error) {
    console.error(`alwaysdata startup failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { configureAlwaysdata, startAlwaysdata };
