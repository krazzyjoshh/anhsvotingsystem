# Deploy ANHS Vote to alwaysdata

Use a Node.js site with Node.js 24. The application serves the built React frontend and API together. See alwaysdata's [Node.js guide](https://help.alwaysdata.com/en/docs/web-hosting/languages/nodejs/configuration/) and [site configuration guide](https://help.alwaysdata.com/en/docs/web-hosting/sites/add-a-site/).

The account's files remain on the host's disk. The alwaysdata launcher stores SQLite in `/home/ACCOUNT/anhs-vote-data/data.sqlite`, outside the repository and public frontend. It checks the account home, storage paths and write access. Docker deployments continue to use the original launcher and require a mounted volume at `/data`.

Replace `ACCOUNT` below with your alwaysdata account name. A GitHub clone contains source code, not your private configuration, database or wallet.

## Install the source

In the alwaysdata SSH terminal:

```sh
export NODEJS_VERSION=24
git clone https://github.com/krazzyjoshh/anhsvotingsystem.git
cd anhsvotingsystem
npm ci --omit=dev
npm --prefix server ci --omit=dev
npm --prefix web ci --include=dev
npm --prefix web run build
```

If already cloned and installed, run `git pull --ff-only` from `anhsvotingsystem` instead. Installing dependencies is required again only when package manifests or lockfiles change. Rebuild the frontend when its source changes.

## Supply private configuration

Use the Node.js site's environment variables or privately upload `server/.env` over SFTP. Runtime variables take priority over values in the file. Required settings are:

| Variable | Value |
| --- | --- |
| `JWT_SECRET` | Existing local value, or a strong random secret for a new setup |
| `ADMIN_EMAIL` | Admin login email |
| `ADMIN_PASSWORD` | Configured admin password |
| `TOKEN_PEPPER` | Preserve the existing value when transferring voting tokens |
| `RPC_URL` | Existing Solana RPC endpoint for the deployed program's network |
| `WALLET_JSON` | Existing wallet's 64-byte JSON array as a private runtime secret |
| `PUBLIC_LIVE_RESULTS` | Existing `true` or `false` value |

Alternatively, privately upload the existing wallet to `/home/ACCOUNT/anhs-vote-data/wallet.json` and use that absolute path as `WALLET_PATH`. Keep the wallet and `.env` readable only by your account (`chmod 600` on each file). Keep secrets out of GitHub and screenshots.

Remove copied `HOST`, `IP`, `PORT`, `DB_PATH`, `STORAGE_PATH`, and `REQUIRE_PERSISTENT_STORAGE` entries from a local or Docker environment file. The launcher uses the site's assigned address and port and defaults to the account's data directory. You may specify a different database filename directly inside `/home/ACCOUNT/anhs-vote-data`; other database locations are rejected.

For a new setup, an empty data directory creates a new database and initial admin. To continue an existing election, stop the old writable instance first and privately transfer the original database and remaining WAL/SHM files to the data directory **before starting the site**. Preserve the wallet, token pepper, RPC network, IDL and saved election address. Setting an admin password does not change credentials in a transferred database.

## Configure the Node.js site

In **Web > Sites**, add or edit a site:

| Field | Value |
| --- | --- |
| Name | `ANHS Vote` |
| Address | Your account's available `ACCOUNT.alwaysdata.net` address or chosen subpath |
| Type | `Node.js` |
| Working directory | `/home/ACCOUNT/anhsvotingsystem` |
| Command | `node /home/ACCOUNT/anhsvotingsystem/server/scripts/start-alwaysdata.js` |
| Node.js version | `24` (under **Environment > Node.js**, or site variable `NODEJS_VERSION=24`) |

Let alwaysdata supply `IP`/`HOST` and `PORT`; copying the local port 4000 is unnecessary. Set your private application variables before saving and starting the site. Use the managed site's start/restart controls to run the server, rather than leaving a process running in an SSH session.

If using a subpath address, the current frontend expects to be served at the root; prefer a dedicated address rather than adding a subpath.

## Verify and update

Open your HTTPS address and check `/api/health`, `/`, `/admin/login`, and a read-only blockchain page. Confirm the expected admin, election address and record counts before enabling writes. Restart the site and confirm its saved data remains present. Keep only one writable instance when continuing an existing election.

The Free plan has limited memory and CPU and is advertised for personal use; check eligibility and capacity before an actual school election. Monitor disk usage and keep database-aware backups. alwaysdata's [backup documentation](https://help.alwaysdata.com/en/docs/web-hosting/backups/) describes its account backups.

| Startup message | Action |
| --- | --- |
| `assigned IP/HOST and PORT` | Start through a Node.js site; use the host's supplied binding |
| `DB_PATH must ...` | Remove an old Docker/Windows DB path or point to the account data directory |
| `Set ... in the project's environment variables` | Add the required private setting and restart the site |
| Wallet error | Correct the private wallet array or Linux wallet path |
| `Frontend build is missing` | Run `npm --prefix web run build` |
| `Attach a persistent volume at /data` | Select `start-alwaysdata.js` as the site command |
