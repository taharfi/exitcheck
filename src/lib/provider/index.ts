import { FixtureProvider } from "./fixture";
import { JupiterProvider } from "./jupiter";
import type { Provider } from "./interface";
export function provider(): Provider {
  if (
    process.env.EXITCHECK_MODE === "fixture" &&
    process.env.NODE_ENV !== "production"
  )
    return new FixtureProvider();
  return new JupiterProvider();
}
