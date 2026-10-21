const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

test("student-link migration preserves existing candidates and can run again", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "anhs-candidate-migration-"));
  const file = path.join(directory, "data.sqlite");
  t.after(() => {
    for (const name of ["data.sqlite", "data.sqlite-wal", "data.sqlite-shm"]) {
      const target = path.join(directory, name);
      if (fs.existsSync(target)) fs.unlinkSync(target);
    }
    fs.rmdirSync(directory);
  });
  const original = new DatabaseSync(file);
  original.exec(`
    CREATE TABLE positions (id INTEGER PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER DEFAULT 0);
    CREATE TABLE candidates (id INTEGER PRIMARY KEY, full_name TEXT NOT NULL,
      position_id INTEGER REFERENCES positions(id), partylist TEXT, grade TEXT, section TEXT, photo_url TEXT);
    INSERT INTO positions VALUES (1, 'President', 3);
    INSERT INTO candidates VALUES (9, 'Legacy Student', 1, 'Unity', 'Grade 10', 'B', '');
  `);
  original.close();
  const boot = () => execFileSync(process.execPath, ["-e", "require(process.argv[1]).close()", require.resolve("../src/db")], {
    env: { ...process.env, DB_PATH: file }, stdio: "pipe",
  });
  boot(); boot();
  const migrated = new DatabaseSync(file);
  try {
    assert.deepEqual({ ...migrated.prepare("SELECT * FROM candidates").get() }, {
      id: 9, full_name: "Legacy Student", position_id: 1, partylist: "Unity", grade: "Grade 10",
      section: "B", photo_url: "", student_id: null,
    });
    assert.equal(migrated.prepare("SELECT sort_order FROM positions WHERE id = 1").get().sort_order, 3);
    const index = migrated.prepare("PRAGMA index_list(candidates)").all().find((entry) => entry.name === "candidates_student");
    assert.equal(index.unique, 1);
  } finally { migrated.close(); }
});
