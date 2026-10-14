const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../scripts/start-production.js"), "utf8");

function fixture(mountinfo, storage = "/data") {
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    process: { env: {
      JWT_SECRET: "test-secret", ADMIN_EMAIL: "test@example.invalid", ADMIN_PASSWORD: "test-password",
      TOKEN_PEPPER: "test-pepper", RPC_URL: "https://example.invalid", DB_PATH: `${storage}/data.sqlite`,
      STORAGE_PATH: storage, REQUIRE_PERSISTENT_STORAGE: "true",
    } },
    require: (name) => {
      if (name === "node:path") return path.posix;
      if (name === "node:fs") return {
        readFileSync: (file) => {
          assert.equal(file, "/proc/self/mountinfo");
          return mountinfo;
        },
      };
      return require(name);
    },
  });
  return module.exports.prepareProduction;
}

test("missing storage rejects startup and reports mount destinations without host sources or secrets", () => {
  const prepare = fixture("1 0 0:1 / / rw - overlay overlay rw\n2 1 0:2 / /app/storage rw - ext4 /private-host-source rw\n");
  assert.throws(prepare, (error) => {
    assert.match(error.message, /Attach a persistent volume at \/data/);
    assert.match(error.message, /Detected mount paths: \["\/","\/app\/storage"\]/);
    assert.doesNotMatch(error.message, /private-host-source|test-secret|test-password|test-pepper/);
    return true;
  });
});

test("a volume at the configured storage path passes the mount check", () => {
  const prepare = fixture("1 0 0:1 / / rw - overlay overlay rw\n2 1 0:2 / /data rw - ext4 /dev/test rw\n");
  assert.throws(prepare, /Set WALLET_JSON as a private secret/);
});

test("mount checks decode Linux escaped spaces in destination paths", () => {
  const prepare = fixture("2 1 0:2 / /persistent\\040data rw - ext4 /dev/test rw\n", "/persistent data");
  assert.throws(prepare, /Set WALLET_JSON as a private secret/);
});
