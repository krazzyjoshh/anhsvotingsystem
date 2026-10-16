const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const db = require("./db");

function create(tokenId, electionId) {
  const sid = crypto.randomUUID();
  const token = jwt.sign({ sub: tokenId, role: "voter", electionId, sid }, process.env.JWT_SECRET, { expiresIn: "2h" });
  const expiresAt = jwt.decode(token).exp * 1000;
  // One atomic claim also protects against simultaneous logins and server restarts.
  const result = db.prepare(`INSERT INTO voter_sessions (token_id, session_id, election_id, expires_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(token_id) DO UPDATE SET
    session_id = excluded.session_id, election_id = excluded.election_id, expires_at = excluded.expires_at
    WHERE voter_sessions.expires_at <= ? OR voter_sessions.election_id != excluded.election_id`)
    .run(tokenId, sid, electionId, expiresAt, Date.now());
  if (!result.changes) throw Object.assign(new Error(
    "This token is already in use on another device or browser. Log out there first, or wait for the session to expire (up to 2 hours)."
  ), { status: 409, code: "TOKEN_IN_USE" });
  return token;
}

function active(payload) {
  if (typeof payload.sid !== "string") return false;
  return !!db.prepare(`SELECT 1 FROM voter_sessions
    WHERE token_id = ? AND session_id = ? AND election_id = ? AND expires_at > ?`)
    .get(payload.sub, payload.sid, payload.electionId, Date.now());
}

function release(tokenId, sid) {
  db.prepare("DELETE FROM voter_sessions WHERE token_id = ? AND session_id = ?").run(tokenId, sid);
}

module.exports = { create, active, release };
