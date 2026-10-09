import { z } from "zod";
import { endpoint } from "@/lib/http";
import { readLimitedText } from "@/lib/read-limited-text";
import { account } from "@/features/account/auth";
import { experimentDB } from "@/features/experiments/store";
import { paperAccountSchema } from "@/features/trade/paper";
import { AppError } from "@/lib/errors";
export const runtime = "nodejs";
function db() {
  return experimentDB().initialize(
    "CREATE TABLE IF NOT EXISTS terminal_journals(wallet TEXT PRIMARY KEY,body TEXT NOT NULL,updated INTEGER NOT NULL);",
  );
}
export async function GET(request: Request) {
  return endpoint(request, async () => {
    const user = await account(request);
    if (!user) return { signedIn: false, account: null };
    const row = await db()
      .prepare("SELECT body FROM terminal_journals WHERE wallet=?")
      .get(user.wallet);
    return {
      signedIn: true,
      account: row
        ? paperAccountSchema.parse(JSON.parse(String(row.body)))
        : null,
    };
  });
}
export async function POST(request: Request) {
  return endpoint(request, async () => {
    const user = await account(request);
    if (!user)
      throw new AppError(
        "SIGN_IN_REQUIRED",
        "Sign in with your wallet to save a private journal. No transaction is authorized.",
        401,
      );
    const input = z
      .object({ account: paperAccountSchema })
      .strict()
      .parse(
        JSON.parse(
          await readLimitedText(
            request,
            250000,
            () =>
              new AppError(
                "BODY_TOO_LARGE",
                "Journal exceeds the cloud backup limit. Export it locally instead.",
                413,
              ),
          ),
        ),
      );
    await db()
      .prepare(
        "INSERT INTO terminal_journals VALUES(?,?,?) ON CONFLICT(wallet) DO UPDATE SET body=excluded.body,updated=excluded.updated",
      )
      .run(user.wallet, JSON.stringify(input.account), Date.now());
    return { saved: true };
  });
}
