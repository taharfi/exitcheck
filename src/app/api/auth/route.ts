import { z } from "zod";
import { endpoint, body } from "@/lib/http";
import { address } from "@/lib/provider/schemas";
import { shadowStore, sessionHash } from "@/features/copy-trading/shadow-store";
import {
  account,
  AuthStore,
  AUTH_COOKIE,
  CHALLENGE_COOKIE,
  readCookie,
  sessionCookie,
} from "@/features/account/auth";
import { AppError } from "@/lib/errors";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return endpoint(request, async () => ({ user: await account(request) }));
}
export async function POST(request: Request) {
  const cookies: string[] = [];
  const response = await endpoint(request, async () => {
    const input = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("challenge"), wallet: address }),
        z.object({
          action: z.literal("verify"),
          signature: z.string().min(64).max(100),
        }),
        z.object({ action: z.literal("logout") }),
      ])
      .parse(await body(request));
    const store = shadowStore(),
      auth = new AuthStore(store),
      origin = process.env.APP_ORIGIN ?? new URL(request.url).origin;
    if (input.action === "logout") {
      await auth.revoke(readCookie(request, AUTH_COOKIE));
      cookies.push(
        sessionCookie(request, AUTH_COOKIE, "", 0),
        sessionCookie(request, CHALLENGE_COOKIE, "", 0),
      );
      return { user: null };
    }
    if (input.action === "challenge") {
      const challenge = await auth.challenge(input.wallet, origin);
      cookies.push(
        sessionCookie(request, CHALLENGE_COOKIE, challenge.token, 300),
      );
      return { message: challenge.message, expiresAt: challenge.expires };
    }
    const token = readCookie(request, CHALLENGE_COOKIE);
    if (!token)
      throw new AppError(
        "LOGIN_EXPIRED",
        "Sign-in request unavailable. Please try again.",
        401,
      );
    const verified = await auth.verify(token, input.signature, origin);
    await auth.revoke(readCookie(request, AUTH_COOKIE));
    const guest = readCookie(request, "exitcheck-shadow");
    const linked = guest
      ? await store.linkGuest(
          sessionHash(guest),
          "wallet:" + verified.user.wallet,
        )
      : false;
    cookies.push(
      sessionCookie(request, AUTH_COOKIE, verified.token, 86400),
      sessionCookie(request, CHALLENGE_COOKIE, "", 0),
    );
    return { user: verified.user, portfolioLinked: linked };
  });
  if (response.ok)
    for (const cookie of cookies) response.headers.append("Set-Cookie", cookie);
  return response;
}
