# ExitCheck

Research a prediction market, inspect available exit liquidity, practice a trade and review the result.

Live product: [exitcheck.xyz](https://exitcheck.xyz) · [Research and paper terminal](https://exitcheck.xyz/trade)

## Current product

- Live prediction-market feeds from Polymarket Gamma/CLOB and Jupiter, with provider labels and quote timestamps.
- Panta production-market discovery and detail prices, with provider filtering, resolution context and attribution. Sandbox/test contracts are included with explicit labels. Current and historical contracts are browsable. Discovery is bounded to 200 catalog rows and 20 initial details, with more details loaded on selection; Panta exit depth and funded execution remain unsupported.
- A simplified **Choose → Research → Practice** terminal. Evidence, risk checks, fee settings, journal and alerts expand when needed.
- DeepSeek research with bounded primary-source context. Unsupported evidence stays unknown; uncalibrated analysis does not justify a directional recommendation.
- Size-aware exit previews against current bids. Quotes and depth expire; missing liquidity is never fabricated.
- Paper orders with human approval, an emergency stop, market/portfolio limits and recognized shared-event caps.
- Compatible paper journals with partial closes, realized results, decision receipts, export and optional wallet-authenticated private backups.
- Provider-confirmed paper settlement where supported. Winning outcomes are never inferred from near-one-dollar prices.
- Browser watch alerts while the page is open and visible; these are not background notifications.
- Solana position inspection, public trader research and wallet-linked copy-agent observation.
- Private paper experiments and a strategy-study workspace with explicit observation and simulation limits.

**Funded execution is disabled.** Wallet login messages authenticate an account; they do not authorize trades. Paper orders/results are simulations, not proof of achievable live performance. Actual venue fees remain unknown; the terminal offers an explicit optional paper fee assumption. No profitable strategy, calibrated forecast or autonomous funded lifecycle is claimed.

## Run locally

Requires Node **24.11+** and npm.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

On PowerShell, use `Copy-Item .env.example .env.local`. Do not overwrite an existing local configuration. Open http://127.0.0.1:3000.

Configure your own server-only Jupiter key and Solana RPC URL using the blank template. Optional DeepSeek/Gemini research settings are described in `.env.example`; Set `RESEARCH_PROVIDER=deepseek` when supplying `DEEPSEEK_API_KEY`; Gemini is also supported. Never supply a seed phrase or private key. Keep `ENABLE_LIVE_EXECUTION=false`.

Production build:

```sh
npm run build
npm start
```

Local development can use the deployed public market feed when direct Gamma connections fail, preserving original timestamps. Production does not call itself. Isolated development fixtures are available through `npm run dev:fixture`; fixtures are not production data.

## Verify

```sh
npm run check
npm run build
npm run verify:secrets
```

Optional browser checks require Chromium: `npx playwright install chromium`, then `npm run test:e2e`. Browser tests use controlled providers to check UI behaviour; they do not prove provider uptime, profitability or funded execution. Live probes are opt-in. Tests use isolated stores.

## Hosting and data

Panta reads require the server-only `PANTA_API_KEY`. Use a production key for production markets; the test key used during verification exposed a sandbox catalog. See [Panta configuration and limits](docs/operations/panta-integration.md). Technology credits identify data, research, wallet and infrastructure integrations.

The live app is hosted on Vercel. Hosted persistence requires your own Turso configuration, app origin, provider credentials and monitoring configuration. Local SQLite is not persistent storage on Vercel. Copy-agent monitoring and terminal watch alerts have different lifecycles: monitoring uses configured hosted workflows; terminal alerts require an open page. Check provider and hosting quotas before enabling collectors.

Private journal backups require wallet authentication and are scoped to that account. Browser paper data remains local until the user explicitly saves a backup. Paper records are user-controlled and are not audited trading history.

## Repository scope

This repository contains the application source, required assets/font licenses, dependency lockfile, configuration templates, tests and validation scripts for the current deployed build. Credentials, runtime databases, personal wallet captures, generated videos/screenshots, local agent integrations and deployment-account metadata are excluded. The production deployment is managed separately from GitHub; pushing this repository does not automatically publish it.

Third-party packages and fonts retain their respective licenses. Read [SECURITY.md](SECURITY.md) for credential handling and execution limitations.
