import nextEnv from "@next/env";
import { address } from "../../src/lib/provider/schemas";
import { JupiterProvider } from "../../src/lib/provider/jupiter";
import { readAgentHistory } from "../../src/features/copy-trading/agent-source";

nextEnv.loadEnvConfig(process.cwd());
const trader = address.parse(
  process.argv[2] ?? "DVHD66wYT5wFcgJ9K2SbtJTmbsJxzz6chkAzNwzbksdT",
);
const provider = new JupiterProvider();
try {
  const baseline = await readAgentHistory(trader, null, (path) =>
    provider.request(path),
  );
  const next = await readAgentHistory(trader, baseline.cursor, (path) =>
    provider.request(path),
  );
  console.log(
    JSON.stringify({
      readOnly: true,
      trader,
      baselineSet: !!baseline.cursor,
      pages: next.pages,
      newFilledEvents: next.fills.length,
      continuity: "provider overlap verified",
      ordersPrepared: 0,
      ordersSubmitted: 0,
    }),
  );
} catch (e) {
  console.error(
    JSON.stringify({
      readOnly: true,
      continuity: "unverified",
      error: e instanceof Error ? e.message : "Source unavailable",
      ordersSubmitted: 0,
    }),
  );
  process.exitCode = 1;
}
