const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { Writable } = require("node:stream");
const { parseArgs } = require("node:util");
const { DatabaseSync } = require("node:sqlite");
const bcrypt = require("bcryptjs");

function resetAdmin(database, email, password) {
  email = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Supply a valid admin email with --email.");
  if (typeof password !== "string" || password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
    throw new Error("The password must contain at least 8 characters and no more than 72 UTF-8 bytes.");
  }
  if (!path.isAbsolute(database) || !fs.existsSync(database) || !fs.statSync(database).isFile()) {
    throw new Error("Choose an existing database file using an absolute path. No database was created.");
  }
  // Open the existing database directly: importing src/db would also initialize its schema.
  const db = new DatabaseSync(database);
  try {
    db.exec("PRAGMA busy_timeout = 5000;");
    const admins = db.prepare("SELECT id, email FROM admins ORDER BY id").all();
    const target = admins.find((admin) => admin.email.trim().toLowerCase() === email) ||
      (admins.length === 1 ? admins[0] : undefined);
    if (!target) throw new Error("No matching admin account. For a database with multiple admins, specify an existing account's email.");
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare("UPDATE admins SET email = ?, password_hash = ? WHERE id = ?").run(email, hash, target.id);
    if (result.changes !== 1) throw new Error("The selected admin account was not updated.");
    return { id: target.id, email };
  } finally {
    db.close();
  }
}

function resetOptions(args, platform = process.platform, home) {
  const { values } = parseArgs({ args, options: {
    alwaysdata: { type: "boolean" }, db: { type: "string" }, email: { type: "string" }, help: { type: "boolean" },
  } });
  if (values.help) return { help: true };
  if (Boolean(values.alwaysdata) === Boolean(values.db)) throw new Error("Choose either --alwaysdata or --db /absolute/path/data.sqlite.");
  if (!values.email) throw new Error("Supply the desired admin login email with --email.");
  if (values.alwaysdata) {
    if (platform !== "linux") throw new Error("Use --alwaysdata in your alwaysdata SSH terminal.");
    home = home || os.userInfo().homedir;
    if (!/^\/home\/[^/]+$/.test(home)) throw new Error("Use --alwaysdata in your alwaysdata SSH terminal.");
  }
  const database = values.alwaysdata ? path.join(home, "anhs-vote-data", "data.sqlite") : values.db;
  if (!path.isAbsolute(database)) throw new Error("--db must be an absolute path.");
  return { database, email: values.email };
}

async function promptPassword() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Run this command in an interactive terminal to enter the password privately.");
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) {
    if (!muted) process.stdout.write(chunk, encoding);
    callback();
  } });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  const ask = (label) => new Promise((resolve, reject) => {
    const cancelled = () => { muted = false; reject(new Error("Password reset cancelled.")); };
    rl.once("close", cancelled);
    muted = false;
    rl.question(label, (value) => {
      rl.removeListener("close", cancelled);
      muted = false;
      process.stdout.write("\n");
      resolve(value);
    });
    muted = true;
  });
  try {
    const password = await ask("New admin password (hidden): ");
    const confirmation = await ask("Enter it again (hidden): ");
    if (password !== confirmation) throw new Error("Passwords do not match. No account was changed.");
    return password;
  } finally {
    muted = false;
    rl.close();
    output.end();
  }
}

async function main() {
  const options = resetOptions(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node server/scripts/reset-admin.js --alwaysdata --email admin@example.com\n" +
      "   or: node server/scripts/reset-admin.js --db /absolute/path/data.sqlite --email admin@example.com\n" +
      "Updates the selected admin only. If there is exactly one admin, its email is also corrected to the requested login email.");
    return;
  }
  console.log(`Database: ${options.database}`);
  const password = await promptPassword();
  const account = resetAdmin(options.database, options.email, password);
  console.log(`Admin login updated: ${account.email}. Election data was preserved.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Admin reset failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { resetAdmin, resetOptions };
