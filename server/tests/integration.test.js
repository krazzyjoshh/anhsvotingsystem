const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "anhs-tests-"));
Object.assign(process.env, { DB_PATH: path.join(temp, "test.sqlite"), JWT_SECRET: "test-only-jwt",
  ADMIN_EMAIL: "test@example.invalid", ADMIN_PASSWORD: "test-only-password", TOKEN_PEPPER: "test-only-pepper", PUBLIC_LIVE_RESULTS: "true" });
let positions, chainStatus, registered, reads, sendCalls, nextFailure;
const confirmed = new Map();
const votes = new Map();
const fakeChain = {
  authority: { toBase58: () => "authority-public-address" },
  estimate: () => ({ publish: 0.1, perVoter: 0.01, allVoters: 0.02 }),
  balance: async () => 1000000000,
  verifyTokens: async (_id, tokens) => ({ registered: tokens.length, total: tokens.length, complete: true }),
  setStatus: async (_id, status) => { chainStatus = status; },
  programId: { toBase58: () => "program-public-address" },
  explorerTx: (s) => `https://explorer.solana.com/tx/${s}?cluster=devnet`,
  results: async () => { reads++; return { title: "Test Election", status: chainStatus, tokensRegistered: registered,
    electionAddress: "public-election-address", positions: positions.map((p) => ({ ...p, candidates: p.candidates.map((c) => ({ ...c })) })) }; },
  signatureStatuses: async (signatures) => signatures.map((s) => confirmed.get(s) ?? null),
  matchesVoteTransaction: async (signature, id, token, batch) => JSON.stringify(votes.get(signature)) === JSON.stringify({ id, token, batch }),
  blockHeight: async () => 500,
  hasVoteRecords: async () => false,
  vote: async (id, token, batch, onPrepared) => {
    const signature = `signature-${++sendCalls}`;
    await onPrepared({ signature, lastValidBlockHeight: 400 });
    votes.set(signature, { id, token, batch });
    if (nextFailure === sendCalls) throw Object.assign(new Error("SENSITIVE RAW RPC PAYLOAD"), { status: 502 });
    confirmed.set(signature, { err: null, confirmationStatus: "confirmed" });
    return { signature };
  },
};
// No real chain module is loaded; tests cannot sign or broadcast transactions.
const chainPath = require.resolve("../src/chain");
require.cache[chainPath] = { id: chainPath, filename: chainPath, loaded: true, exports: fakeChain };
const app = require("../src/index");
const db = require("../src/db");
const settings = require("../src/settings");
const election = require("../src/election");
const models = require("../src/models");
let server = app.listen(0, "127.0.0.1");
let ready = new Promise((resolve) => server.once("listening", resolve));
const admin = jwt.sign({ sub: 1, role: "admin" }, process.env.JWT_SECRET);
const voter = (id = 1, electionId = 101) => jwt.sign({ sub: id, role: "voter", electionId }, process.env.JWT_SECRET);
async function request(url, { token, method = "GET", body } = {}) {
  await ready;
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api${url}`, { method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json(), cache: response.headers.get("cache-control") };
}
function fixture(count = 2) {
  for (const table of ["receipt_transactions", "submission_batches", "receipts", "voting_tokens", "students", "candidates", "positions", "settings", "election_archive"])
    db.prepare(`DELETE FROM ${table}`).run();
  positions = [];
  for (let i = 1; i <= count; i++) {
    db.prepare("INSERT INTO positions (id, name, sort_order) VALUES (?, ?, ?)").run(i, `Position ${i}`, i);
    // Reverse insertion deliberately verifies alphabetical ordering.
    db.prepare("INSERT INTO candidates (id, full_name, position_id) VALUES (?, ?, ?)").run(i * 10 + 2, `Zed ${i}`, i);
    db.prepare("INSERT INTO candidates (id, full_name, position_id) VALUES (?, ?, ?)").run(i * 10 + 1, `Ana ${i}`, i);
    positions.push({ index: i - 1, name: `Position ${i}`, candidates: [{ name: `Ana ${i}`, votes: 0 }, { name: `Zed ${i}`, votes: 0 }] });
  }
  for (let i = 1; i <= 2; i++) {
    db.prepare("INSERT INTO students (id, lrn, first_name, last_name, grade, section) VALUES (?, ?, ?, ?, ?, ?)").run(i, `LRN${i}`, `Student${i}`, "Example", "Grade 7", "A");
    db.prepare("INSERT INTO voting_tokens (id, code, student_id) VALUES (?, ?, ?)").run(i, `ABCDEF0${i}`, i);
  }
  settings.set("election_id", 101); settings.set("election_address", "public-election-address"); settings.set("status", "open"); settings.set("title", "Test Election");
  registered = 2; chainStatus = 1; reads = 0; sendCalls = 0; nextFailure = null;
  confirmed.clear(); votes.clear(); election.invalidate(); process.env.PUBLIC_LIVE_RESULTS = "true";
}
const selections = () => Object.fromEntries(positions.map((_, i) => [i + 1, (i + 1) * 10 + 1]));
const submit = (body = selections()) => request("/vote/submit", { token: voter(), method: "POST", body: { selections: body } });
after(async () => { await new Promise((resolve) => server.close(resolve)); db.close(); fs.rmSync(temp, { recursive: true, force: true }); });

test("admin login verifies the password and admin pages reject voter and invalid sessions", async () => {
  fixture();
  const login = (body) => request("/admin/login", { method: "POST", body });
  assert.equal((await login({ email: process.env.ADMIN_EMAIL, password: "wrong-password" })).status, 401);
  assert.equal((await login({ email: "unknown@example.invalid", password: process.env.ADMIN_PASSWORD })).status, 401);
  const correct = await login({ email: process.env.ADMIN_EMAIL.toUpperCase(), password: process.env.ADMIN_PASSWORD });
  assert.equal(correct.status, 200);
  const claims = jwt.verify(correct.data.token, process.env.JWT_SECRET);
  assert.equal(claims.role, "admin");
  assert.equal(claims.exp - claims.iat, 8 * 60 * 60);
  const profile = await request("/admin/me", { token: correct.data.token });
  assert.deepEqual(profile.data, { id: 1, email: process.env.ADMIN_EMAIL });
  for (const token of [undefined, "invalid-token", voter()]) {
    assert.equal((await request("/admin/me", { token })).status, 401);
    assert.equal((await request("/admin/stats", { token })).status, 401);
  }
});
test("public endpoints share a five-second cache and whitelist status fields", async () => {
  fixture();
  const responses = await Promise.all(Array.from({ length: 12 }, () => request("/public/status")));
  assert.equal(reads, 1);
  assert.equal(responses[0].status, 200);
  assert.deepEqual(Object.keys(responses[0].data).sort(), ["published", "status", "title", "tokensRegistered", "turnoutPercent", "votesCast",
    "students", "activeStudents", "blockchainError",
    "schoolYear", "periodStart", "periodEnd", "announcement"].sort());
  assert.equal(responses[0].cache, "no-store");
  await request("/public/results"); assert.equal(reads, 1);
  await request("/admin/results", { token: admin });
  await request("/admin/blockchain", { token: admin });
  assert.equal(reads, 1);
});

test("landing registration totals reflect student changes before publication", async () => {
  fixture(); settings.set("status", "pending"); settings.set("election_address", "");
  settings.set("school_year", "SY 2026-2027"); settings.set("announcement", "Registration is open.");
  const initial = await request("/public/status");
  assert.equal(initial.status, 200);
  assert.equal(initial.data.students, 2); assert.equal(initial.data.activeStudents, 2);
  assert.equal(initial.data.tokensRegistered, 0); assert.equal(initial.data.published, false);
  const added = await request("/admin/students", { token: admin, method: "POST", body: {
    lrn: "NEW-PUBLIC-STUDENT", first_name: "New", last_name: "Student", grade: "Grade 8", section: "B" } });
  assert.equal(added.status, 201);
  assert.equal((await request(`/admin/students/${added.data.id}/active`, { token: admin, method: "PATCH",
    body: { active: false } })).status, 200);
  const updated = (await request("/public/status")).data;
  const stats = (await request("/admin/stats", { token: admin })).data;
  for (const field of ["students", "activeStudents"]) {
    assert.equal(updated[field], stats[field]);
  }
  assert.equal(updated.students, 3); assert.equal(updated.activeStudents, 2);
  assert.equal(updated.schoolYear, "SY 2026-2027"); assert.equal(updated.announcement, "Registration is open.");
  assert.equal(updated.votesCast, 0); assert.equal(updated.turnoutPercent, 0);
  assert.equal(updated.blockchainError, ""); assert.equal(reads, 0);
});

test("landing turnout uses active students and counts only completed submissions", async () => {
  fixture();
  await request("/admin/students", { token: admin, method: "POST", body: {
    lrn: "PUBLIC-EXTRA-STUDENT", first_name: "Extra", last_name: "Student", grade: "Grade 8", section: "B" } });
  assert.equal((await submit()).status, 200);
  const status = (await request("/public/status")).data;
  const snapshotReads = reads;
  assert.equal(status.students, 3); assert.equal(status.activeStudents, 3);
  assert.equal(status.tokensRegistered, 2);
  assert.equal(status.votesCast, 1);
  assert.equal(status.turnoutPercent, 33.33);
  db.prepare("UPDATE students SET active = 0 WHERE id = 2").run();
  const updated = (await request("/public/status")).data;
  assert.equal(updated.activeStudents, 2); assert.equal(updated.turnoutPercent, 50);
  assert.equal(reads, snapshotReads); // Student totals stay fresh even while the chain snapshot is cached.
  db.prepare("UPDATE students SET active = 0").run();
  assert.equal((await request("/public/status")).data.turnoutPercent, 0);
});

test("landing registration totals and metadata remain available during blockchain outages", async () => {
  fixture(); assert.equal((await submit()).status, 200);
  settings.set("announcement", "Voting is open.");
  const original = fakeChain.results;
  fakeChain.results = async () => { throw Object.assign(new Error("PRIVATE RPC PAYLOAD"), { status: 502 }); };
  election.invalidate();
  try {
    const response = await request("/public/status");
    assert.equal(response.status, 200); assert.equal(response.cache, "no-store");
    assert.equal(response.data.students, 2); assert.equal(response.data.activeStudents, 2);
    assert.equal(response.data.votesCast, 1); assert.equal(response.data.turnoutPercent, 50);
    assert.equal(response.data.status, "open"); assert.equal(response.data.published, true);
    assert.equal(response.data.tokensRegistered, null);
    assert.equal(response.data.announcement, "Voting is open.");
    assert.equal(response.data.blockchainError, "Unable to get a response from the blockchain.");
    assert.ok(!JSON.stringify(response.data).includes("PRIVATE"));
    assert.equal((await request("/public/results")).status, 502);
  } finally { fakeChain.results = original; election.invalidate(); }
});

test("manual student addition works for pending and published elections and rejects duplicates clearly", async () => {
  fixture();
  const student = { lrn: "000000000030", last_name: " Example ", first_name: "New", grade: "Grade 7", section: "A" };
  const add = (body = student, token = admin) => request("/admin/students", { token, method: "POST", body });
  assert.equal((await add(student, voter())).status, 401);
  assert.equal((await add({ ...student, first_name: " " })).status, 400);
  const added = await add(); assert.equal(added.status, 201);
  assert.equal(db.prepare("SELECT last_name FROM students WHERE id = ?").get(added.data.id).last_name, "Example");
  const duplicate = await add(); assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data.error, "A student with this LRN already exists.");
  settings.set("status", "pending"); settings.set("election_address", "");
  assert.equal((await add({ ...student, lrn: "000000000031" })).status, 201);
  const stats = await request("/admin/stats", { token: admin });
  assert.equal(stats.data.students, 4); assert.equal(stats.data.activeStudents, 4);
  const filtered = await request("/admin/students?search=000000000031&grade=Grade%207", { token: admin });
  assert.equal(filtered.data.students.length, 1);
});

test("student status and token generation preserve one token per eligible student", async () => {
  fixture(); settings.set("status", "pending"); settings.set("election_address", "");
  const added = await request("/admin/students", { token: admin, method: "POST", body: {
    lrn: "NEW-TOKEN-STUDENT", first_name: "New", last_name: "Student", grade: "Grade 8", section: "B" } });
  const generate = () => request("/admin/tokens/generate", { token: admin, method: "POST", body: { mode: "name", student_id: added.data.id } });
  const toggle = (active) => request(`/admin/students/${added.data.id}/active`, { token: admin, method: "PATCH", body: { active } });
  assert.equal((await toggle(false)).status, 200);
  assert.equal((await generate()).status, 404);
  assert.equal((await toggle(true)).status, 200);
  const generated = await generate();
  assert.equal(generated.status, 201);
  assert.deepEqual(generated.data, { created: 1, skipped: 0 });
  const originalToken = db.prepare("SELECT * FROM voting_tokens WHERE student_id = ?").get(added.data.id);
  const duplicate = await generate();
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data.error, "This student already has a voting token. Duplicate tokens are not allowed.");
  assert.deepEqual(db.prepare("SELECT * FROM voting_tokens WHERE student_id = ?").get(added.data.id), originalToken);
  db.prepare("UPDATE voting_tokens SET used = 1 WHERE student_id = ?").run(added.data.id);
  assert.equal((await generate()).status, 409);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM voting_tokens WHERE student_id = ?").get(added.data.id).n, 1);
  const duplicateStudent = await request("/admin/students", { token: admin, method: "POST", body: {
    lrn: "NEW-TOKEN-STUDENT", first_name: "New", last_name: "Student", grade: "Grade 8", section: "B" } });
  assert.equal(duplicateStudent.status, 409);
  assert.equal(duplicateStudent.data.error, "A student with this LRN already exists.");
  const tokens = await request("/admin/tokens?grade=Grade%208&section=B&active=1", { token: admin });
  assert.equal(tokens.data.tokens.length, 1);
  settings.set("election_address", "public-election-address");
  assert.equal((await generate()).status, 409);
});

test("batch token generation rejects all duplicates and skips existing tokens in mixed batches", async () => {
  fixture(); settings.set("status", "pending"); settings.set("election_address", "");
  const generate = (body = { mode: "grade", grade: "Grade 7", section: "A" }) => request("/admin/tokens/generate", { token: admin, method: "POST", body });
  const originalTokens = db.prepare("SELECT * FROM voting_tokens ORDER BY id").all();
  const duplicates = await generate();
  assert.equal(duplicates.status, 409);
  assert.equal(duplicates.data.error, "All selected students already have voting tokens. Duplicate tokens are not allowed.");
  assert.deepEqual(db.prepare("SELECT * FROM voting_tokens ORDER BY id").all(), originalTokens);
  const added = await request("/admin/students", { token: admin, method: "POST", body: {
    lrn: "NEW-BATCH-STUDENT", first_name: "New", last_name: "Student", grade: "Grade 7", section: "A" } });
  assert.equal(added.status, 201);
  const mixed = await generate();
  assert.equal(mixed.status, 201);
  assert.deepEqual(mixed.data, { created: 1, skipped: 2 });
  for (const original of originalTokens) assert.deepEqual(db.prepare("SELECT * FROM voting_tokens WHERE id = ?").get(original.id), original);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM voting_tokens WHERE student_id = ?").get(added.data.id).n, 1);
  assert.equal((await generate({ mode: "grade", grade: "Grade 7" })).status, 409);
  assert.equal((await generate({ mode: "grade", grade: "Grade 7", section: "Missing" })).status, 404);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM voting_tokens").get().n, 3);
});

test("ballot and metadata setup work before publishing and enforce the published lock", async () => {
  fixture(); settings.set("status", "pending"); settings.set("election_address", "");
  const position = await request("/admin/positions", { token: admin, method: "POST", body: { name: "Secretary" } });
  assert.equal(position.status, 201);
  const candidate = await request("/admin/candidates", { token: admin, method: "POST", body: { full_name: "New Candidate", position_id: position.data.id } });
  assert.equal(candidate.status, 201);
  const metadata = { title: "New Election", schoolYear: "SY 2026-2027", periodStart: "", periodEnd: "", announcement: "Welcome" };
  const save = (body) => request("/admin/election/settings", { token: admin, method: "PUT", body });
  assert.equal((await save(metadata)).status, 200);
  settings.set("election_address", "public-election-address");
  assert.equal((await request("/admin/positions", { token: admin, method: "POST", body: { name: "Locked" } })).status, 409);
  assert.equal((await save({ ...metadata, title: "Changed" })).status, 409);
  assert.equal((await save({ ...metadata, announcement: "Updated" })).status, 409);
  assert.equal(settings.get("announcement"), "Welcome");
});

test("all election information stays locked during publishing, publication, live voting and closure", async () => {
  fixture(); settings.set("status", "pending"); settings.set("election_address", "");
  const metadata = { title: "Locked Election", schoolYear: "SY 2026-2027", periodStart: "2026-10-12T08:00", periodEnd: "2026-10-12T17:00", announcement: "Voting schedule" };
  const save = (body) => request("/admin/election/settings", { token: admin, method: "PUT", body });
  assert.equal((await save(metadata)).status, 200);
  const changes = { title: "Changed title", schoolYear: "SY 2027-2028", periodStart: "2026-10-13T08:00", periodEnd: "2026-10-13T17:00", announcement: "Changed announcement" };
  for (const state of [
    { publishing: "1", status: "pending", address: "" },
    { publishing: "0", status: "pending", address: "public-election-address" },
    { publishing: "0", status: "published", address: "" },
    { publishing: "0", status: "open", address: "" },
    { publishing: "0", status: "closed", address: "" },
  ]) {
    settings.set("publishing", state.publishing); settings.set("status", state.status); settings.set("election_address", state.address);
    for (const [field, value] of Object.entries(changes)) {
      const response = await save({ ...metadata, [field]: value });
      assert.equal(response.status, 409);
      assert.equal(response.data.error, "Election information cannot be changed once publishing has started. Start a new election to edit it.");
    }
    assert.equal((await save(metadata)).status, 409);
    const information = (await request("/admin/election/settings", { token: admin })).data;
    assert.equal(information.published, true);
    for (const [field, value] of Object.entries(metadata)) assert.equal(information[field], value);
  }
});

test("blockchain information survives balance RPC failures and retains election results", async () => {
  fixture();
  const original = fakeChain.balance;
  fakeChain.balance = async () => { throw Object.assign(new Error("PRIVATE RPC PAYLOAD"), { status: 502 }); };
  try {
    const response = await request("/admin/blockchain", { token: admin });
    assert.equal(response.status, 200); assert.equal(response.data.balance, null);
    assert.equal(response.data.tokensRegistered, 2);
    assert.equal(response.data.job.error, "Unable to get a response from the blockchain.");
  } finally { fakeChain.balance = original; }
});

test("closed elections archive results and prepare a new election without losing receipts", async () => {
  fixture(); const receipt = await submit(); chainStatus = 2; election.invalidate();
  const response = await request("/admin/blockchain/new-election", { token: admin, method: "POST" });
  assert.equal(response.status, 200); assert.equal(response.data.archivedElectionId, 101);
  assert.equal(settings.get("election_address"), ""); assert.equal(settings.get("status"), "pending");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM election_archive").get().n, 1);
  assert.equal(db.prepare("SELECT used FROM voting_tokens WHERE id = 1").get().used, 0);
  assert.equal(db.prepare("SELECT has_voted FROM students WHERE id = 1").get().has_voted, 0);
  assert.equal((await request(`/public/receipt/${receipt.data.receiptCode}`)).data.valid, true);
  const metadata = { title: "Next Election", schoolYear: "SY 2027-2028", periodStart: "2027-10-12T08:00", periodEnd: "2027-10-12T17:00", announcement: "New election" };
  assert.equal((await request("/admin/election/settings", { token: admin, method: "PUT", body: metadata })).status, 200);
  const information = (await request("/admin/election/settings", { token: admin })).data;
  assert.deepEqual(information, { ...metadata, published: false });
  assert.equal(db.prepare("SELECT title FROM election_archive WHERE election_id = 101").get().title, "Test Election");
});
test("CSV upload imports friendly headers, reports invalid rows and preserves voter state on updates", async () => {
  fixture(); settings.set("election_address", ""); settings.set("status", "pending");
  db.prepare("UPDATE students SET active = 0, has_voted = 1 WHERE id = 1").run();
  const upload = (csv, token = admin) => request("/admin/students/upload", { token, method: "POST", body: { csv } });
  const response = await upload("LRN;Last Name;First Name;Grade Level;Section\nLRN1;Changed;Student;Grade 8;B\n000000000003;Example;New;Grade 7;A\n000000000004;Missing;;Grade 7;A");
  assert.equal(response.status, 200);
  assert.deepEqual(response.data, { count: 2, inserted: 1, updated: 1, skipped: 1, details: [{ row: 4, error: "Missing first_name." }] });
  const existing = db.prepare("SELECT * FROM students WHERE lrn = 'LRN1'").get();
  assert.equal(existing.last_name, "Changed"); assert.equal(existing.active, 0); assert.equal(existing.has_voted, 1);
  assert.ok(db.prepare("SELECT 1 FROM students WHERE lrn = '000000000003'").get());
  const invalid = await upload("lrn,last_name,first_name,grade,section\n05,Example,,Grade 7,A");
  assert.equal(invalid.status, 400); assert.equal(invalid.data.details[0].row, 2);
  assert.equal((await upload("Full Name,Grade,Section\nStudent Example,Grade 7,A")).status, 400);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM students").get().n, 3);
  assert.equal((await upload("lrn,last_name,first_name,grade,section\n07,Example,Student,Grade 7,A", voter())).status, 401);
  settings.set("election_address", "public-election-address"); settings.set("status", "open");
  assert.equal((await upload("lrn,last_name,first_name,grade,section\n07,Example,Student,Grade 7,A")).status, 409);
});
test("CSV preview writes nothing and mapped row corrections produce the same imported records", async () => {
  fixture(); settings.set("election_address", ""); settings.set("status", "pending");
  const csv = "Identifier|Label|Group\n000000000010|Santos Juan|A\n000000000011|Reyes Ana|B";
  const options = { delimiter: "|", hasHeader: true, headerRow: 1, mapping: { lrn: 0, full_name: 1, section: 2 }, defaults: { grade: "7" }, nameOrder: "last-first", rowOverrides: { 3: { first_name: "Ana Maria" } } };
  const preview = await request("/admin/students/preview", { token: admin, method: "POST", body: { csv, options } });
  assert.equal(preview.status, 200); assert.equal(preview.data.count, 2); assert.ok(!("students" in preview.data));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM students").get().n, 2);
  const imported = await request("/admin/students/upload", { token: admin, method: "POST", body: { csv, options } });
  assert.equal(imported.status, 200); assert.equal(imported.data.inserted, 2);
  for (const row of preview.data.rows) {
    const saved = db.prepare("SELECT * FROM students WHERE lrn = ?").get(row.student.lrn);
    for (const [field, value] of Object.entries(row.student)) assert.equal(saved[field], value);
  }
  assert.equal((await request("/admin/students/preview", { token: voter(), method: "POST", body: { csv } })).status, 401);
  settings.set("status", "open");
  assert.equal((await request("/admin/students/preview", { token: admin, method: "POST", body: { csv } })).status, 409);
});
test("closed-only configuration hides tally in both public result endpoints", async () => {
  fixture(); process.env.PUBLIC_LIVE_RESULTS = "false";
  for (const route of ["/public/results", "/public/election"]) {
    const response = await request(route);
    assert.equal(response.data.resultsVisible, false);
    assert.ok(!("votes" in response.data.positions[0].candidates[0]));
  }
  chainStatus = 2; election.invalidate();
  const closed = await request("/public/results"); assert.equal(closed.data.resultsVisible, true);
  assert.equal(closed.data.positions[0].candidates[0].votes, 0);
});
test("ledger rejects anonymous users and every removed operation returns 404", async () => {
  fixture(); assert.equal((await request("/admin/ledger")).status, 401);
  assert.equal((await request("/admin/ledger/verify", { method: "POST" })).status, 401);
  for (const [method, url] of [["POST", "/students/reset"], ["DELETE", "/students"], ["DELETE", "/students/1"],
    ["PUT", "/candidates/1"], ["DELETE", "/candidates/1"], ["DELETE", "/positions/1"], ["DELETE", "/tokens/unused"], ["DELETE", "/tokens/1"]])
    for (const token of [undefined, admin]) assert.equal((await request(`/admin${url}`, { method, token })).status, 404);
});
test("voter me returns only election title and student name/grade/section", async () => {
  fixture(); assert.equal((await request("/vote/me")).status, 401);
  const me = await request("/vote/me", { token: voter() }); assert.equal(me.status, 200);
  assert.deepEqual(me.data, { title: "Test Election", student: { fullName: "Student1 Example", grade: "Grade 7", section: "A" } });
  assert.equal((await request("/vote/me", { token: voter(1, 100) })).status, 401);
  db.prepare("UPDATE voting_tokens SET used = 1 WHERE id = 1").run();
  const used = await request("/vote/me", { token: voter() }); assert.equal(used.status, 409); assert.equal(used.data.code, "TOKEN_USED");
});
test("models preserve ordering and validate published candidate snapshot", async () => {
  fixture(); assert.deepEqual(models.positionCandidates(1).map((c) => c.full_name), ["Ana 1", "Zed 1"]);
  assert.equal(models.candidatePosition(11).id, 1); assert.equal(models.studentToken(1).id, 1); assert.equal(models.tokenStudent(1).first_name, "Student1");
  assert.equal(await models.candidateVotes(11), 0);
  db.prepare("UPDATE candidates SET full_name = 'Changed' WHERE id = 11").run();
  assert.equal((await request("/vote/ballot", { token: voter() })).status, 503);
});
test("all-abstain creates one receipt without broadcasting and signature check is N/A", async () => {
  fixture(); const response = await submit({ 1: null, 2: null }); assert.equal(response.status, 200);
  assert.equal(sendCalls, 0); assert.equal(response.data.kind, "abstain"); assert.deepEqual(response.data.signatures, []);
  assert.equal((await request(`/public/receipt/${response.data.receiptCode}`)).data.valid, true);
  const report = await request("/admin/ledger/verify", { token: admin, method: "POST" });
  assert.ok(report.data.checks.some((c) => c.id.startsWith("receipt:") && c.status === "N/A"));
  assert.equal(report.data.consistent, true);
});
test("multi-batch receipts persist every signature and recover a lost response idempotently", async () => {
  fixture(7); const response = await submit(); assert.equal(response.status, 200); assert.equal(sendCalls, 2);
  assert.equal(response.data.signatures.length, 2); assert.equal(db.prepare("SELECT COUNT(*) AS n FROM receipt_transactions").get().n, 2);
  const repeated = await submit(); assert.equal(repeated.status, 200); assert.deepEqual(repeated.data, response.data); assert.equal(sendCalls, 2);
  const pub = await request(`/public/receipt/${response.data.receiptCode}`);
  assert.equal(pub.data.signatures.length, 2); assert.ok(!("token_hash" in pub.data));
  const ledger = await request("/admin/ledger", { token: admin }); assert.ok(!JSON.stringify(ledger.data).includes("token_hash"));
  const report = await request("/admin/ledger/verify", { token: admin, method: "POST" });
  assert.equal(report.data.checks.filter((c) => c.id.startsWith("signature:") && c.status === "PASS").length, 2);
});
test("partial submission resumes using SQLite metadata without resending a confirmed batch", async () => {
  fixture(7); nextFailure = 2;
  assert.equal((await submit()).status, 503);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM receipts").get().n, 0);
  assert.equal(db.prepare("SELECT used FROM voting_tokens WHERE id = 1").get().used, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM submission_batches").get().n, 2);
  // A fresh router has no shared in-memory inflight set or batch progress.
  delete require.cache[require.resolve("../src/routes/voter")];
  delete require.cache[require.resolve("../src/index")];
  await new Promise((resolve) => server.close(resolve));
  server = require("../src/index").listen(0, "127.0.0.1");
  ready = new Promise((resolve) => server.once("listening", resolve));
  nextFailure = null;
  const resumed = await submit(); assert.equal(resumed.status, 200); assert.equal(sendCalls, 3);
  assert.equal(resumed.data.signatures.length, 2);
});
test("pending signatures cannot be resent before expiry", async () => {
  fixture(); nextFailure = 1; assert.equal((await submit()).status, 503);
  fakeChain.blockHeight = async () => 100;
  assert.equal((await submit()).status, 503); assert.equal(sendCalls, 1);
  fakeChain.blockHeight = async () => 500;
});
test("changing a confirmed partial batch is rejected instead of silently accepted", async () => {
  fixture(7); nextFailure = 2; await submit();
  const changed = selections(); changed[1] = 12;
  const response = await submit(changed); assert.equal(response.status, 409); assert.equal(response.data.code, "BALLOT_LOCKED");
  assert.equal(sendCalls, 2); assert.equal(db.prepare("SELECT COUNT(*) AS n FROM receipts").get().n, 0);
});
test("RPC uncertainty and chain errors are reported as WARNING or FAIL", async () => {
  fixture(); const response = await submit(); confirmed.delete(response.data.signatures[0]);
  let report = await request("/admin/ledger/verify", { token: admin, method: "POST" });
  assert.ok(report.data.checks.some((c) => c.id.startsWith("signature:") && c.status === "WARNING"));
  confirmed.set(response.data.signatures[0], { err: { custom: 1 }, confirmationStatus: "finalized" });
  report = await request("/admin/ledger/verify", { token: admin, method: "POST" });
  assert.ok(report.data.checks.some((c) => c.id.startsWith("signature:") && c.status === "FAIL"));
  const original = fakeChain.signatureStatuses; fakeChain.signatureStatuses = async () => { throw new Error("PRIVATE RPC DATA"); };
  report = await request("/admin/ledger/verify", { token: admin, method: "POST" });
  assert.ok(report.data.checks.some((c) => c.id === "rpc" && c.status === "WARNING")); fakeChain.signatureStatuses = original;
});
test("new-election counts exclude old receipts but verification preserves them", async () => {
  fixture(); const first = await submit();
  settings.set("election_id", 102); settings.set("chain_map", "");
  db.prepare("UPDATE voting_tokens SET used = 0").run(); election.invalidate();
  assert.equal((await request("/public/status")).data.votesCast, 0);
  assert.equal((await request(`/public/receipt/${first.data.receiptCode}`)).data.valid, true);
  assert.equal((await request("/admin/ledger", { token: admin })).data.receipts.length, 0);
  assert.equal((await request("/vote/me", { token: voter() })).status, 401);
});
test("legacy missing signatures and token mismatches are warnings", async () => {
  fixture(); db.prepare("INSERT INTO receipts (receipt_code, token_hash) VALUES ('LEGACY000001', 'opaque')").run(); registered = 1; election.invalidate();
  const report = await request("/admin/ledger/verify", { token: admin, method: "POST" });
  assert.ok(report.data.checks.some((c) => c.id === "tokens" && c.status === "WARNING"));
  assert.ok(report.data.checks.some((c) => c.id === "legacy" && c.status === "WARNING"));
  assert.equal((await request("/public/receipt/UNKNOWN00001")).data.valid, false);
});
