const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../scripts/start-alwaysdata.js"), "utf8");
function fixture({ env = {}, platform = "linux", home = "/home/test-account", link, dotenvValues = {} } = {}) {
  const environment = { IP: "2001:db8::1", PORT: "8100", ...env };
  const operations = [];
  const module = { exports: {} };
  let started = false;
  vm.runInNewContext(source, {
    module, __dirname: "/home/test-account/app/server/scripts", process: { env: environment, platform },
    require: (name) => {
      if (name === "node:path") return path.posix;
      if (name === "node:os") return { userInfo: () => ({ homedir: home }) };
      if (name === "node:fs") return {
        constants: { R_OK: 4, W_OK: 2 },
        mkdirSync: (file, options) => operations.push(["mkdir", file, options.mode]),
        realpathSync: (file) => link?.[file] || file,
        existsSync: (file) => Boolean(link?.[file]),
        accessSync: (file, mode) => operations.push(["access", file, mode]),
      };
      if (name === "./start-production") return { startProduction: () => { started = true; }, cleanWallet: () => {} };
      if (name === "dotenv") return { config: () => {
        for (const [key, value] of Object.entries(dotenvValues)) {
          if (environment[key] === undefined) environment[key] = value;
        }
      } };
      return require(name);
    },
  });
  return { ...module.exports, env: environment, operations, started: () => started };
}

test("alwaysdata uses persistent account storage and the assigned IPv6 binding", () => {
  const app = fixture({ env: { HOST: "127.0.0.1", REQUIRE_PERSISTENT_STORAGE: "true" } });
  app.configureAlwaysdata();
  assert.equal(app.env.HOST, "2001:db8::1");
  assert.equal(app.env.PORT, "8100");
  assert.equal(app.env.DB_PATH, "/home/test-account/anhs-vote-data/data.sqlite");
  assert.equal(app.env.NODE_ENV, "production");
  assert.deepEqual(app.operations, [
    ["mkdir", "/home/test-account/anhs-vote-data", 0o700],
    ["access", "/home/test-account/anhs-vote-data", 6],
  ]);
});

test("alwaysdata accepts the host's HOST variable when IP is absent", () => {
  const app = fixture({ env: { IP: undefined, HOST: "::1" } });
  app.configureAlwaysdata();
  assert.equal(app.env.HOST, "::1");
});

test("alwaysdata refuses other operating systems and non-account home directories", () => {
  for (const options of [{ platform: "win32" }, { home: "/tmp/account" }, { home: "/home" }]) {
    const app = fixture(options);
    assert.throws(app.configureAlwaysdata, /alwaysdata Linux account/);
    assert.deepEqual(app.operations, []);
  }
});

test("alwaysdata requires a valid platform binding before creating storage", () => {
  for (const env of [{ IP: undefined }, { PORT: undefined }, { PORT: "0" }, { PORT: "65536" }, { PORT: "8100oops" }]) {
    const app = fixture({ env });
    assert.throws(app.configureAlwaysdata, /assigned IP\/HOST and PORT/);
    assert.deepEqual(app.operations, []);
  }
});

test("alwaysdata rejects copied Docker, Windows, relative and traversal database paths", () => {
  for (const database of ["/data/data.sqlite", "C:\\app\\data.sqlite", "data.sqlite", "/home/test-account/anhs-vote-data/../data.sqlite"]) {
    const app = fixture({ env: { DB_PATH: database } });
    assert.throws(app.configureAlwaysdata, /DB_PATH must/);
    assert.deepEqual(app.operations, []);
  }
});

test("alwaysdata rejects storage or database symlinks outside the account data directory", () => {
  for (const link of [
    { "/home/test-account/anhs-vote-data": "/tmp/ephemeral" },
    { "/home/test-account/anhs-vote-data/data.sqlite": "/tmp/ephemeral.sqlite" },
  ]) {
    const app = fixture({ link });
    assert.throws(app.configureAlwaysdata, /must not link outside/);
    assert.equal(app.started(), false);
  }
});

test("alwaysdata loads private configuration while preserving the platform binding and runtime secrets", () => {
  const app = fixture({ env: { JWT_SECRET: "runtime-secret" }, dotenvValues: {
    HOST: "127.0.0.1", PORT: "4000", JWT_SECRET: "file-secret", TOKEN_PEPPER: "file-pepper",
  } });
  app.startAlwaysdata();
  assert.equal(app.env.HOST, "2001:db8::1");
  assert.equal(app.env.PORT, "8100");
  assert.equal(app.env.JWT_SECRET, "runtime-secret");
  assert.equal(app.env.TOKEN_PEPPER, "file-pepper");
  assert.equal(app.started(), true);
});

test("a PORT copied from a local env file cannot replace a missing platform binding", () => {
  const app = fixture({ env: { PORT: undefined }, dotenvValues: { PORT: "4000" } });
  assert.throws(app.startAlwaysdata, /assigned IP\/HOST and PORT/);
  assert.equal(app.started(), false);
});
