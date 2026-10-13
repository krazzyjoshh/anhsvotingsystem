const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let temporaryWallet;
let temporaryDirectory;

function cleanWallet() {
  if (temporaryWallet) fs.unlinkSync(temporaryWallet);
  if (temporaryDirectory) fs.rmdirSync(temporaryDirectory);
  temporaryWallet = temporaryDirectory = undefined;
}

function prepareProduction() {
  process.env.NODE_ENV = "production";
  for (const name of ["JWT_SECRET", "ADMIN_EMAIL", "ADMIN_PASSWORD", "TOKEN_PEPPER", "RPC_URL", "DB_PATH"]) {
    if (!process.env[name]) throw new Error(`Set ${name} in the project's environment variables.`);
  }
  const database = process.env.DB_PATH;
  if (!path.isAbsolute(database)) throw new Error("DB_PATH must be an absolute path.");

  if (process.env.REQUIRE_PERSISTENT_STORAGE === "true") {
    const storage = path.resolve(process.env.STORAGE_PATH || "/data");
    const relative = path.relative(storage, database);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("DB_PATH must be a file inside STORAGE_PATH.");
    }
    // An image directory alone does not preserve SQLite across redeploys.
    const mountPoints = fs.readFileSync("/proc/self/mountinfo", "utf8").split("\n")
      .map((line) => (line.split(" ")[4] || "").replace(/\\([0-7]{3})/g, (_, value) => String.fromCharCode(parseInt(value, 8))));
    if (!mountPoints.includes(storage)) {
      throw new Error(`Attach a persistent volume at ${storage} before starting this app.`);
    }
  }

  let secret;
  if (process.env.WALLET_JSON) {
    try { secret = JSON.parse(process.env.WALLET_JSON); }
    catch { throw new Error("WALLET_JSON must contain the existing Solana wallet's JSON array."); }
  } else if (process.env.WALLET_PATH && fs.existsSync(process.env.WALLET_PATH)) {
    try { secret = JSON.parse(fs.readFileSync(process.env.WALLET_PATH, "utf8")); }
    catch { throw new Error("WALLET_PATH must point to a readable Solana wallet JSON file."); }
  } else {
    throw new Error("Set WALLET_JSON as a private secret, or set WALLET_PATH to a mounted wallet file.");
  }
  if (!Array.isArray(secret) || secret.length !== 64 || secret.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new Error("The Solana wallet must be a JSON array of 64 bytes.");
  }
  try { require("@anchor-lang/core").web3.Keypair.fromSecretKey(Uint8Array.from(secret)); }
  catch { throw new Error("The Solana wallet secret key is invalid."); }

  if (process.env.WALLET_JSON) {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "anhs-wallet-"));
    temporaryWallet = path.join(temporaryDirectory, "wallet.json");
    fs.writeFileSync(temporaryWallet, JSON.stringify(secret), { mode: 0o600 });
    process.env.WALLET_PATH = temporaryWallet;
    delete process.env.WALLET_JSON;
  }
  fs.mkdirSync(path.dirname(database), { recursive: true });
}

function startProduction() {
  prepareProduction();
  const app = require("../src/index");
  const host = process.env.HOST || "0.0.0.0";
  const port = Number(process.env.PORT || 4000);
  const server = app.listen(port, host, () => console.log(`ANHS Vote ready on port ${server.address().port}.`));
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  return server;
}

if (require.main === module) {
  process.on("exit", cleanWallet);
  try { startProduction(); }
  catch (error) {
    console.error(`Production startup failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { prepareProduction, startProduction, cleanWallet };
