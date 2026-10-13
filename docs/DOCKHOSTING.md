# Deploy ANHS Vote to DockHosting

This repository now includes a Docker deployment that serves the React frontend and Express API from one URL. It uses Node.js 24 and connects to the existing Solana program. No Rust build, Solana CLI, or new blockchain deployment is needed.

## 1. Create the project

In DockHosting, choose **Create project**, then the source/deployment option offered by your dashboard. Use the **Free** plan. For a repository deployment, choose the repository containing these files and configure:

| Setting | Value |
| --- | --- |
| Project name | `anhs-vote` (or your preferred name) |
| Root/build context | Repository root, `.` |
| Build method | Docker / Dockerfile |
| Dockerfile | `Dockerfile` |
| Internal port | `4000`, unless DockHosting assigns a different `PORT` |
| Health check path, if configurable | `/api/health` |
| Instances/replicas, if configurable | `1` |

Use the repository root, not `server/` or the older `server/web/`. The Dockerfile needs `web/`, `server/`, and `chain/target/idl/voting_system.json`.

You do not need **Create database**: this app uses SQLite, not a managed Postgres/MySQL database. A managed database connection string cannot replace `DB_PATH` without a code migration.

Official guides: [Docker deployment](https://docs.dockhosting.dev/docs/deploying/docker), [Quickstart](https://docs.dockhosting.dev/docs/quickstart).

If you need a clean source copy to put in a repository, run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-dockhosting.ps1`. The execution-policy option applies only to this process. It creates `deployment/anhs-vote-dockhosting.zip` using only the deployment source and guides. Extract that archive before uploading its contents to a repository. It deliberately excludes live configuration, the database, and wallet keys. Keep the folder structure and runtime IDL intact. If your dashboard offers a source ZIP upload, use this archive only after confirming that upload method is supported.

## 2. Attach persistent storage before starting

In the project's storage/volume settings, attach a persistent volume at **`/data`**. Confirm that the volume is included in the Free plan before proceeding. If the dashboard requires payment for storage, do not upgrade: this SQLite deployment cannot safely operate without persistent storage.

The Docker image defaults to:

```dotenv
DB_PATH=/data/data.sqlite
STORAGE_PATH=/data
REQUIRE_PERSISTENT_STORAGE=true
```

These defaults are already in the Dockerfile. Leave the storage check enabled. Startup deliberately fails if `/data` is only a directory inside the container, rather than a mounted volume. This avoids silently losing election records on redeploy.

The container runs as the `node` user (UID/GID 1000). The mounted volume must allow that user to create and update `/data/data.sqlite` and its WAL/SHM files. If startup reports a permission error, adjust volume permissions using the platform's supported management tools; do not make the database publicly accessible.

Official guide: [Environment variables and storage](https://docs.dockhosting.dev/docs/environment-variables).

## 3. Add private environment variables

Copy values privately from your local `server/.env` into the project's environment variables. Do not upload `.env` into a repository, a source archive, or the Docker image.

Set application variables to **Runtime only**. If the dashboard has an **Available at Buildtime** checkbox, clear it for these variables, particularly `WALLET_JSON`, `JWT_SECRET`, `ADMIN_PASSWORD`, and `TOKEN_PEPPER`. The Docker build does not need the wallet or application secrets. `NODE_ENV=production` is already defined for the runtime image; keep any dashboard override runtime-only as well. The frontend stage explicitly installs development dependencies so Vite remains available even if the platform injects a production build environment.

| Variable | Value |
| --- | --- |
| `JWT_SECRET` | Existing value from local configuration |
| `ADMIN_EMAIL` | Existing admin email |
| `ADMIN_PASSWORD` | Existing configured admin password |
| `TOKEN_PEPPER` | **Exactly the existing value**, especially for registered tokens |
| `RPC_URL` | Existing RPC URL for the deployed program's network |
| `PUBLIC_LIVE_RESULTS` | Existing setting, `true` or `false` |
| `WALLET_JSON` | Entire JSON array from the **existing server wallet file**, stored as a private secret |

The wallet is the file referenced by `WALLET_PATH` in your local configuration. Paste its JSON array directly into the private secret field, without additional surrounding quotes. Do not send it in chat. The startup script validates it and writes a temporary file readable only by the server user. That temporary file is regenerated from the secret on every start.

Do not copy a Windows `WALLET_PATH` to a Linux deployment. As an alternative to `WALLET_JSON`, a securely mounted wallet file can be used with its Linux absolute `WALLET_PATH`. The wallet and database must stay outside the public frontend directory.

The Dockerfile sets `NODE_ENV=production` and `HOST=0.0.0.0`. Let DockHosting supply `PORT` if it assigns one; the server uses that value.

## 4. Decide whether this is a fresh demo or a migration

For a fresh demo, the app creates its schema and initial admin on the empty volume. Using the existing wallet does not automatically restore students, voting tokens, receipts, or a previously published election's address.

To continue an existing election:

1. Stop the local app and finish any pending blockchain transactions before transferring data. Keep the old writable instance stopped afterwards.
2. Back up the current SQLite database named by `DB_PATH`, or `server/data.sqlite` if no path is configured. Retain any remaining `-wal` and `-shm` files together with it.
3. Privately transfer the database and any WAL/SHM files into the mounted `/data` volume **before allowing the deployed app to initialize an empty database**. Use the provider's authenticated volume upload/import mechanism. If the dashboard has no supported upload mechanism, establish one with DockHosting support before attempting the migration.
4. Preserve the existing `TOKEN_PEPPER`, wallet, RPC network, and IDL. Existing admin credentials stay in the copied database; setting `ADMIN_PASSWORD` does not overwrite them.

Database files and wallet keys are intentionally excluded from deployment source. Never put them in GitHub or bake them into an image to work around the volume upload step.

See [Windows transfer guide](WINDOWS_TRANSFER.md) for the same election-data preservation requirements.

## 5. Deploy and verify

Start the deployment once the volume and secrets are configured. Check the build/runtime logs. Open the generated HTTPS URL and verify:

- `/api/health` returns JSON with `ok: true`.
- `/` loads the voter website.
- `/admin/login` loads when opened directly or refreshed.
- The admin can sign in using the expected account.
- The blockchain page can read the existing program/election on the configured RPC network.
- A controlled restart/redeploy preserves a non-sensitive saved setting or test record. Test persistence before opening voting.

For an existing election, compare the saved election address and counts with the local backup before enabling any write operations. Initial online verification should use reads, rather than publishing another election or submitting a real vote.

Free apps sleep when idle. Avoid deployments during active voting or token publication. DockHosting's rolling deployment can briefly run old and new versions at the same time; keep a single writable application instance and perform redeploys outside those operations.

## Common startup messages

| Message | Action |
| --- | --- |
| `Set ... in the project's environment variables` | Add that runtime variable and redeploy |
| `Attach a persistent volume at /data` | Attach the volume; do not disable the storage check |
| `WALLET_JSON must contain ...` / `wallet ... invalid` | Privately copy the existing wallet's actual JSON array |
| `Frontend build is missing` | Use the repository-root Dockerfile, which builds `web/` |
| `vite: not found` during the build | Use the latest Dockerfile with `npm ci --include=dev`; keep `NODE_ENV` runtime-only |
| Database permission error | Make `/data` writable by container UID/GID 1000 |
| Blockchain read/transaction error | Verify RPC network, wallet funding on that network, IDL, and saved election address |

## Local validation

```powershell
npm.cmd --prefix web run build
npm.cmd --prefix server test
```

If Docker is installed, validate the image with `docker build -t anhs-vote .`. This command does not deploy anything. Actual cloud storage, RPC reachability, and account-specific Free-plan allowances still need verification in DockHosting.
