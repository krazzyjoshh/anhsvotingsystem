const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "../.env"), quiet: true });
const anchor = require("@anchor-lang/core");
const chain = require("../src/chain");
const db = require("../src/db");
const election = require("../src/election");

async function main() {
  const connection = new anchor.web3.Connection(process.env.RPC_URL || "https://api.devnet.solana.com", {
    commitment: "confirmed", disableRetryOnRateLimit: true,
    fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(10000) }),
  });
  const electionId = Number(db.prepare("SELECT value FROM settings WHERE key = 'election_id'").get()?.value);
  const published = election.published();
  const unpublished = { skipped: true, reason: "The election has not been published yet." };
  const requireAccount = (account) => {
    if (!account) throw Object.assign(new Error("The account could not be found on the configured Solana network."), { status: 503 });
    return account;
  };
  const checks = [
    ["RPC connection", () => connection.getVersion()],
    ["Deployed program", async () => ({ exists: Boolean(requireAccount(await connection.getAccountInfo(chain.programId))) })],
    ["Election account", async () => published
      ? { exists: Boolean(requireAccount(await connection.getAccountInfo(chain.electionPda(electionId)))) }
      : unpublished],
    ["Saved election address", async () => {
      if (!published) return unpublished;
      const address = db.prepare("SELECT value FROM settings WHERE key = 'election_address'").get()?.value;
      if (!address) throw Object.assign(new Error("The published election has no saved election address."), { status: 503 });
      const account = requireAccount(await connection.getAccountInfo(new anchor.web3.PublicKey(address)));
      const idl = require("../../chain/target/idl/voting_system.json");
      const decoded = account ? new anchor.BorshAccountsCoder(idl).decode("Election", account.data) : null;
      return { exists: Boolean(account), matchesResolvedAddress: address === chain.electionPda(electionId).toBase58(),
        owner: account?.owner.toBase58(), election: decoded && { id: decoded.id?.toString(),
          status: decoded.status, authorityMatches: decoded.authority.toBase58() === chain.authority.toBase58() } };
    }],
    ["Wallet balance", async () => ({ sol: await connection.getBalance(chain.authority) / 1e9 })],
    ["Election results", async () => {
      if (!published) return unpublished;
      const result = await chain.results(electionId);
      return { status: result.status, positions: result.positions.length, tokensRegistered: result.tokensRegistered,
        authorityMatches: result.authority === chain.authority.toBase58() };
    }],
  ];
  for (const [name, check] of checks) {
    try { console.log(JSON.stringify({ check: name, ok: true, result: await check() })); }
    catch (error) {
      console.log(JSON.stringify({ check: name, ok: false, status: error.status,
        reason: error.status ? error.message : error.cause?.code || error.code || error.name }));
      process.exitCode = 1;
    }
  }
}
main().catch(() => { console.error("Blockchain configuration could not be loaded."); process.exitCode = 1; })
  .finally(() => db.close());
setTimeout(() => process.exit(2), 55000).unref();
