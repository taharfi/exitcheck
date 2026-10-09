import nextEnv from "@next/env";
import nacl from "tweetnacl";
import bs58 from "bs58";

nextEnv.loadEnvConfig(process.cwd(), false);
const origin = "https://exitcheck.xyz";
const pair = nacl.sign.keyPair();
const wallet = bs58.encode(pair.publicKey);
const cookies = new Map<string, string>();
async function call(path: string, body?: unknown, authenticated = false) {
  const response = await fetch(origin + path, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "Content-Type": "application/json", Origin: origin } : {}),
      ...(authenticated ? { Cookie: [...cookies.values()].join("; ") } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90000),
  });
  if (authenticated)
    for (const value of response.headers.getSetCookie()) {
      const cookie = value.split(";")[0];
      cookies.set(cookie.split("=")[0], cookie);
      if (!value.includes("HttpOnly") || !value.includes("Secure"))
        throw new Error("Production login cookie is not secured");
    }
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      `Deployment check ${path} failed (${response.status}, ${result.error?.code ?? "unknown"})`,
    );
  return result;
}
let planId: string | undefined;
try {
  const health = await call("/api/health");
  if (health.status !== "ready" || health.executionEnabled !== false)
    throw new Error("Unexpected production health state");
  if (
    (await call("/api/auth")).user !== null ||
    (await call("/api/agent")).plan !== null
  )
    throw new Error("Anonymous privacy boundary failed");
  const challenge = await call(
    "/api/auth",
    { action: "challenge", wallet },
    true,
  );
  if (
    !challenge.message.startsWith("exitcheck.xyz wants you") ||
    !challenge.message.includes(`URI: ${origin}\n`)
  )
    throw new Error("Wrong sign-in domain");
  const signature = bs58.encode(
    nacl.sign.detached(
      new TextEncoder().encode(challenge.message),
      pair.secretKey,
    ),
  );
  await call("/api/auth", { action: "verify", signature }, true);
  if ((await call("/api/auth", undefined, true)).user?.wallet !== wallet)
    throw new Error("Signed-in session did not persist");
  if ((await call("/api/auth")).user !== null)
    throw new Error("Session leaked to an anonymous request");
  const snapshot = await call(
    "/api/agent",
    {
      action: "start",
      settings: {
        trader: "DVHD66wYT5wFcgJ9K2SbtJTmbsJxzz6chkAzNwzbksdT",
        budget: "100",
        entry: "10",
      },
    },
    true,
  );
  planId = snapshot.plan?.id;
  if (!planId || snapshot.execution !== "disabled")
    throw new Error("Private observation plan did not start");
  if (
    (await call("/api/agent", undefined, true)).plan?.id !== planId ||
    (await call("/api/agent")).plan !== null
  )
    throw new Error("Private plan persistence or isolation failed");
  const initialPolls = snapshot.plan.polls;
  const secret = process.env.CRON_SECRET;
  if (!secret)
    throw new Error("Operator monitoring secret is unavailable locally");
  const started = await fetch(origin + "/api/internal/monitoring", {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!started.ok)
    throw new Error(`Monitoring launch failed (${started.status})`);
  console.log(
    JSON.stringify({
      phase: "hosted",
      health: "ready",
      securedDomainLogin: true,
      sessionPersisted: true,
      privatePlanPersisted: true,
      anonymousIsolation: true,
      monitoringLaunch: await started.json(),
      initialPolls,
      tradesSigned: 0,
      tradesSubmitted: 0,
    }),
  );
  // Verify scheduled work without issuing a manual refresh or keeping a page open.
  const deadline = Date.now() + 160000;
  let advanced = false;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 15000));
    const state = await call("/api/agent", undefined, true);
    if (state.plan?.polls > initialPolls) {
      advanced = true;
      break;
    }
  }
  if (!advanced)
    throw new Error(
      "Background monitoring did not advance within the verification window",
    );
  console.log(
    JSON.stringify({
      backgroundPollAdvanced: true,
      manualRefreshes: 0,
      tradesSigned: 0,
      tradesSubmitted: 0,
    }),
  );
} finally {
  if (planId) await call("/api/agent", { action: "stop", planId }, true);
  if (cookies.has("exitcheck-account"))
    await call("/api/auth", { action: "logout" }, true);
}
