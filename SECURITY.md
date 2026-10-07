# Security and execution limits

Keep all API keys, RPC credentials, database auth tokens and cron secrets server-only. Never commit environment files, wallet secrets, session cookies or runtime databases. The template contains no credentials.

The copy agent observes trades and proposes preliminary plans; it has no wallet approval or trade submission path. Keep live execution disabled. The exit prototype's allowlist and simulation are not a complete instruction audit and do not establish safe trading. A passing unsigned simulation does not prove enforced price limits, all future fees, keeper fill or profitability.

Wallet login uses a signed message for session authentication, not permission to move funds. Private plans require wallet-owned sessions and same-origin writes. RPC and upstream provider trust remain; in-process rate limiting is not a distributed abuse-control system.

Do not publish reports containing credentials or personal wallet activity. Use GitHub private vulnerability reporting if enabled, or privately contact the repository owner before sharing a suspected vulnerability.
