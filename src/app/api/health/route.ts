export const dynamic = "force-dynamic";
export async function GET() {
  const fixture =
    process.env.EXITCHECK_MODE === "fixture" &&
    process.env.NODE_ENV !== "production";
  const ready = fixture || !!process.env.JUPITER_API_KEY;
  return Response.json(
    {
      status: ready ? "ready" : "setup-required",
      provider: "Jupiter Prediction",
      mode: fixture ? "fixture" : "production",
      network: "mainnet-beta",
      executionEnabled:
        !fixture &&
        process.env.ENABLE_LIVE_EXECUTION === "true" &&
        !!process.env.ALLOWED_PROGRAM_IDS &&
        !!process.env.SOLANA_RPC_URL,
      setup: ready
        ? null
        : "Add JUPITER_API_KEY to .env.local and restart. Read-only wallet lookup then becomes available.",
    },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
