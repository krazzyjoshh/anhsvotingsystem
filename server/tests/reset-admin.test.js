const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const bcrypt = require("bcryptjs");
const { resetAdmin, resetOptions } = require("../scripts/reset-admin");

function fixture(t, emails = ["old@example.invalid"]) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "anhs-admin-reset-"));
  const file = path.join(directory, "data.sqlite");
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE admins (id INTEGER PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT);
    CREATE TABLE election_records (id INTEGER PRIMARY KEY, data TEXT);
    INSERT INTO election_records VALUES (1, 'preserve-students-tokens-receipts');`);
  const originalHash = bcrypt.hashSync("original-test-password", 4);
  for (let i = 0; i < emails.length; i++) db.prepare("INSERT INTO admins VALUES (?, ?, ?)").run(i + 10, emails[i], originalHash);
  t.after(() => {
    db.close();
    for (const name of ["data.sqlite", "data.sqlite-wal", "data.sqlite-shm"]) {
      const disposable = path.join(directory, name);
      if (fs.existsSync(disposable)) fs.unlinkSync(disposable);
    }
    fs.rmdirSync(directory);
  });
  return { db, file, originalHash };
}

test("reset corrects a sole admin login, preserves its id and election data, and hashes literal special characters", (t) => {
  const { db, file, originalHash } = fixture(t);
  const password = "Test-reset-password#'";
  assert.deepEqual(resetAdmin(file, "  ADMIN@example.invalid  ", password), { id: 10, email: "admin@example.invalid" });
  const admin = db.prepare("SELECT * FROM admins").get();
  assert.equal(admin.id, 10);
  assert.equal(admin.email, "admin@example.invalid");
  assert.notEqual(admin.password_hash, originalHash);
  assert.notEqual(admin.password_hash, password);
  assert.equal(bcrypt.compareSync(password, admin.password_hash), true);
  assert.equal(bcrypt.compareSync("original-test-password", admin.password_hash), false);
  assert.equal(db.prepare("SELECT data FROM election_records").get().data, "preserve-students-tokens-receipts");
});

test("reset selects only the requested admin when multiple accounts exist", (t) => {
  const { db, file, originalHash } = fixture(t, ["first@example.invalid", "second@example.invalid"]);
  resetAdmin(file, "SECOND@example.invalid", "second-new-password");
  assert.equal(db.prepare("SELECT password_hash FROM admins WHERE id = 10").get().password_hash, originalHash);
  assert.equal(bcrypt.compareSync("second-new-password", db.prepare("SELECT password_hash FROM admins WHERE id = 11").get().password_hash), true);
  assert.throws(() => resetAdmin(file, "unknown@example.invalid", "valid-test-password"), /No matching admin/);
});

test("invalid reset inputs leave credentials unchanged and missing database files are not created", (t) => {
  const { db, file, originalHash } = fixture(t);
  for (const [email, password] of [["invalid", "valid-password"], ["a@example.invalid", "short"], ["a@example.invalid", "é".repeat(37)]]) {
    assert.throws(() => resetAdmin(file, email, password));
  }
  const missing = path.join(path.dirname(file), "missing.sqlite");
  assert.throws(() => resetAdmin(missing, "a@example.invalid", "valid-password"), /existing database/);
  assert.equal(fs.existsSync(missing), false);
  assert.equal(db.prepare("SELECT password_hash FROM admins").get().password_hash, originalHash);
});

test("reset refuses an empty admin table instead of initializing a new account", (t) => {
  const { db, file } = fixture(t, []);
  assert.throws(() => resetAdmin(file, "a@example.invalid", "valid-password"), /No matching admin/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM admins").get().count, 0);
});

test("reset requires an explicit database target and refuses an alwaysdata target on another host", () => {
  const home = "/home/test-account";
  const options = resetOptions(["--alwaysdata", "--email", "a@example.invalid"], "linux", home);
  assert.equal(options.database, path.join(home, "anhs-vote-data", "data.sqlite"));
  for (const args of [[], ["--alwaysdata", "--db", "/tmp/data.sqlite"], ["--db", "relative.sqlite", "--email", "a@example.invalid"]]) {
    assert.throws(() => resetOptions(args, "linux", home));
  }
  assert.throws(() => resetOptions(["--alwaysdata", "--email", "a@example.invalid"], "win32", home), /SSH terminal/);
});
