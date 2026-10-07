export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Vercel uses durable workflows; do not start process-local timers there.
  if (process.env.VERCEL === "1") return;
  if (process.env.AGENT_COLLECTOR_ENABLED === "true") {
    const { startAgentCollector } =
      await import("./features/copy-trading/agent-collector");
    await startAgentCollector();
  }
  if (process.env.SHADOW_COLLECTOR_ENABLED === "true") {
    const { startShadowCollector } =
      await import("./features/copy-trading/shadow-collector");
    await startShadowCollector();
  }
  if (process.env.MARKET_RECORDER_ENABLED === "true") {
    const { startMarketRecorder } =
      await import("./features/prediction-bot/market-recorder");
    await startMarketRecorder();
  }
}
