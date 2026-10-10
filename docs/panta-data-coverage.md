# Panta data coverage

Reviewed the complete published documentation index on 10 October 2026, including authentication, account operations, catalog, transaction creation, primary orders, claims and attribution. Source: https://docs.panta.market/llms.txt

## User-facing reads

| API family | ExitCheck use |
| --- | --- |
| List / get market | Existing catalog, rules, timestamps, status and detail spot prices. Added native category, region, market type, total volume, graduation flag and primary/secondary price pairs. |
| Categories | Show provider's actual category allowlist with market activity. |
| Market trades | On-demand recent catalog tape; up to 50 rows, explorer links, primary flag, amounts and reported fees. |
| Wallet trades | User-requested public wallet catalog history, up to 50 rows. |
| Positions | User-requested share holdings, both sides retained, resolution outcome, claimed and claimable flags. No fabricated USD value or PnL. Provider caps and indexing lag are labelled. |

Activity and holdings appear inside an expandable Panta panel in Trade & Research. Public wallet addresses are transmitted to Panta only when the user requests lookup. Runtime response schemas strip unknown fields. API credentials stay server-side. No account endpoints are proxied publicly; all upstream paths are fixed and validated.

Market catalog total volume is not 24-hour volume or bid depth. List prices are not treated as live. Resolved/closed/cancelled spot prices remain suppressed. Unknown fields remain unavailable. There is no sell-orderbook depth endpoint in the published index.

## Reviewed but not exposed as public data

- Account, dashboard, metrics, creates, attributed trades and API-key lists describe the integration account. These are not user portfolio statistics; account records include private identifiers and email.
- Auth register/login/refresh, account updates and key creation/revocation are operator administration, not market research.
- Market quote/build/register and image upload create paid market sessions and require wallet-signed transactions. They are separate product actions.
- Primary quote/build/submit/verify, win claims, creator-fee claims and trade reporting form a transaction lifecycle. Data expansion does not enable these actions. A quote can create a server session even before signing.
- Attribution status is not a general public trading ledger. Partner metrics do not represent all Panta activity.
- Raw images, social handles, oracle blobs and transaction instruction payloads are not blindly embedded. The terminal keeps verified typed data and does not fetch arbitrary upstream URLs.

Live checks returned HTTP 200 for catalog/detail, categories, market tape, wallet tape and positions. The supplied test wallet returned no positions or catalog trades; populated holdings and failure cases are covered with deterministic unit fixtures. Live detail responses also contain fields beyond the published catalog schema; those require documented unit/meaning verification before being used for valuation or strategy signals.

## Sources

- https://docs.panta.market/api-reference/markets/list
- https://docs.panta.market/api-reference/markets/get
- https://docs.panta.market/api-reference/markets/trades
- https://docs.panta.market/api-reference/markets/wallet-trades
- https://docs.panta.market/api-reference/markets/categories
- https://docs.panta.market/api-reference/positions
- https://docs.panta.market/api-reference/account/get
- https://docs.panta.market/api-reference/account/metrics
- https://docs.panta.market/guides/how-it-works
- https://docs.panta.market/guides/errors
- https://docs.panta.market/guides/terms-of-use
