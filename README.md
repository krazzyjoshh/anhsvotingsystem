# anhs-voting-system-blockchain

ANHS Vote is a school election system for Agusan National High School. It includes an English voter interface, an admin portal, student CSV import, assigned voting tokens, receipts, public results, and Solana Devnet integration.

## Requirements

- Node.js 24 LTS with npm
- A browser and internet access for Solana Devnet
- The existing server wallet and configuration, transferred privately

## Install and run

```sh
npm ci
npm --prefix server ci
npm --prefix web ci
```

For a new local setup, copy `server/.env.example` to `server/.env` and supply the required values. To continue an existing election, privately restore the original `server/.env`, SQLite database and any remaining WAL/SHM files, and existing wallet. Preserve `TOKEN_PEPPER` and update `WALLET_PATH` for the new machine. Stop the old app before copying the database and keep the old writable copy stopped after migration.

The backend requires `chain/target/idl/voting_system.json`, which is included in this repository. Running the existing app does not require rebuilding or redeploying the Solana program.

```sh
npm run dev
```

On this Windows account, PowerShell is configured with `RemoteSigned`, so `npm run dev` works directly. On another machine, if PowerShell blocks `npm.ps1`, use Command Prompt or `npm.cmd`.

Run the development command in one terminal. To restart, press Ctrl+C in that terminal first. Startup checks both ports before launching the API and frontend, and shuts down both processes if either exits.

- Application: http://127.0.0.1:5173
- Admin login: http://127.0.0.1:5173/admin/login
- API health: http://127.0.0.1:4000/api/health

The active frontend is in `web/`; `server/web/` is an earlier frontend.

## Deploying to DockHosting

Follow [the DockHosting guide](docs/DOCKHOSTING.md) to serve the website and API from one Docker deployment. A persistent volume at `/data` and private runtime secrets are required. Verify Free-plan storage availability before deploying; the production launcher refuses to use an unmounted container directory for election data.

## Moving to another laptop

Follow [the Windows transfer guide](docs/WINDOWS_TRANSFER.md). A GitHub clone provides source code and the IDL; `.env`, SQLite data, and wallet keys require a separate private transfer. Install dependencies on the destination operating system instead of copying `node_modules`.

## Validation

```sh
npm --prefix web run build
npm --prefix server test
```

Server tests use isolated test data and mocked blockchain operations.

Run both the server suite and frontend build with `npm test`. To check the live
RPC connection, deployed program, saved election account, wallet balance, and
results without sending transactions, run `npm --prefix server run diagnose`.
Election account and result checks are skipped until an election has been published.

Published elections use the saved election address for blockchain reads and
transactions, including databases transferred from another machine. Students
can still be added manually to the directory after publication; their voting
tokens can be generated while preparing the next election. CSV updates, ballot
changes, and token generation stay locked for the published election.
