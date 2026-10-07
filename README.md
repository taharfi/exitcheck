# ExitCheck

Solana prediction-market position checks, public trader research and a wallet-linked copy-agent workspace.

Live app: https://exitcheck.xyz

## Current scope

- Inspect positions and estimate proceeds for an exit size against current bids.
- Discover and compare public traders; replay history with explicit assumptions.
- Sign in with a wallet message to manage private observation plans and decision journals.
- Monitor filled trades and review indicative entry prices, wallet budgets and exit coverage.

**Copy-agent trading is disabled.** Login signatures do not authorize trades. Unsigned diagnostics can simulate builds, but instruction semantics, enforced price limits, full costs and the funded trading lifecycle remain unverified. No profitability guarantee is made.

## Local setup

Requires Node 24.11+ and npm.

```sh
npm ci
cp .env.example .env.local
```

On PowerShell use `Copy-Item .env.example .env.local`. Configure your own server-only Jupiter API key and Solana mainnet RPC URL in that file. Never enter a seed phrase or private key. Keep `ENABLE_LIVE_EXECUTION=false`.

```sh
npm run dev
```

Open http://127.0.0.1:3000. For isolated, labelled development examples use `npm run dev:fixture`.

## Verification

```sh
npm run check
npm run build
```

Optional browser tests require `npx playwright install chromium`. Run `npm run test:smoke` or `npm run test:e2e`. Tests use isolated stores; opt-in provider probes make external requests and should be run only with a public address you intend to inspect.

## Hosting

Vercel deployments require your own server-only Jupiter/RPC configuration, Turso database URL and auth token, app origin and monitoring cron secret. See the blank configuration template in [.env.example](.env.example). Local SQLite is not persistent storage on Vercel. Durable monitoring consumes workflow quotas; verify your hosting limits before enabling it. This repository is not automatically connected to the existing production deployment.

## Repository scope

Includes app source, required assets and font licenses, dependency lockfile, test fixtures, validation scripts and configuration templates. Runtime databases, wallet diagnostic captures, credentials, screenshots, local agent integrations and deployment account metadata are excluded. Historical source-control history was not available; this is a snapshot of the current build. Third-party packages and fonts retain their respective licenses.

Read [SECURITY.md](SECURITY.md) for execution limitations and credential handling.
