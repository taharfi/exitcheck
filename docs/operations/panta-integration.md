# Panta market research integration

Panta supplies a read-only Solana prediction-market feed in `/trade`. The market-feed selector exposes Panta separately from Polymarket and Jupiter Forecast. Existing research and paper-order workflows use validated provider data; this integration cannot sign, submit or settle real trades.

## Configuration

Set `PANTA_API_KEY` in the ignored `.env.local`. Obtain a key through Panta's documented account/API-key flow. Never paste credentials into chat, public source, browser storage or a `NEXT_PUBLIC_` variable. Restart local development after changing configuration. For hosting, set the same server-only variable in Vercel and redeploy.

Missing credentials or upstream failures leave the existing feeds available and show an explicit Panta availability notice. No example contracts replace real data. On October 9, 2026, the test API key returned a sandbox contract, while a production key exposed paginated real markets. The production adapter returned six eligible contracts, four available for paper pricing at the time of the probe. This verifies API reads, not trade execution or sponsor acceptance.

## Data and limits

- Fixed documented origin: `https://live-api.panta.market/api/v1`.
- Trailing slashes, `X-Api-Key` authentication, redirects rejected, four-second timeout and bounded response reads.
- Up to four catalog pages of 50 rows; initial detail reads for up to 20 prioritized contracts, with additional details loaded on selection, at most four concurrently. Repeated cursors terminate discovery. The UI discloses truncation and partial price failures.
- Catalog prices are ignored. Only validated, matching market-detail prices enable paper orders. Missing prices remain unknown, not complementary inferred quotes.
- Rows are checked for market identity, status, phase, scheduled start/end and resolution time. Scheduled contracts can be researched; paper orders are conservatively blocked before the provider's scheduled start and after end. This does not verify the protocol's live primary-buy window.
- The live API currently returns ISO timestamp strings and phase-based active status (`primary`), unlike the documentation's Unix-seconds/open-status example. Both documented and observed timestamp formats are supported; closed, resolved and cancelled contracts remain available for browsing with status labels and without live prices or paper execution.
- `volumeUsdc` is cumulative volume, not 24-hour volume; the current UI leaves 24-hour volume and liquidity unknown.
- Detail questions, descriptions, resolution rules and source URLs supply contract context when available. Blank catalog titles can be recovered from the detail question. No oracle is invented, and the generic Panta homepage link is not represented as a verified per-market URL. Explicitly named sandbox/test contracts are included and labeled as test contracts; their data remains explicitly identified as test data in research and paper practice.
- Paper fills approximate reported spot prices. Real bonding-curve price impact, execution fees, secondary sell liquidity and settlement are unsupported. Exit-depth requests explicitly reject Panta instead of routing it through Jupiter or Polymarket.

The required exact linked attribution, “Powered by Panta”, appears alongside Panta paper functionality and in terminal credits when actual Panta contracts are available. Landing previews also attribute Panta if a Panta contract appears there. General technology credits identify the current application services.

## Official references

- [Catalog list](https://docs.panta.market/api-reference/markets/list)
- [Detail prices](https://docs.panta.market/api-reference/markets/get)
- [Authentication](https://docs.panta.market/guides/authentication)
- [Attribution and API terms](https://docs.panta.market/guides/terms-of-use)

Provider normalization, unavailable credentials, detail-price failures, identity mismatches, request concurrency, trading-close guards and unsupported exit depth have automated coverage. Those checks do not establish sponsor acceptance, live API access or execution capability.
