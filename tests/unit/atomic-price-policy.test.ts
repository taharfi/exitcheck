import { describe, expect, it } from "vitest";
import {
  minimumOutcomeUnits,
  netOutputMeetsPriceCap,
} from "../../src/features/copy-trading/atomic-price-policy";

describe("atomic outcome price requirements", () => {
  it("rounds output upward so a $5 buy cannot exceed $0.90 per contract", () => {
    expect(minimumOutcomeUnits("5000000", "900000", 6)).toBe("5555556");
    expect(netOutputMeetsPriceCap("5555555", "5000000", "900000", 6)).toBe(
      false,
    );
    expect(netOutputMeetsPriceCap("5555556", "5000000", "900000", 6)).toBe(
      true,
    );
  });
  it("uses mint decimals and includes the whole USDC debit", () => {
    expect(minimumOutcomeUnits("5000000", "500000", 9)).toBe("10000000000");
    expect(minimumOutcomeUnits("5000000", "500000", 0)).toBe("10");
    expect(netOutputMeetsPriceCap("9999999", "5000000", "500000", 6)).toBe(
      false,
    );
  });
  it("preserves values beyond the JS safe integer range", () => {
    expect(minimumOutcomeUnits("9007199254740993", "500000", 6)).toBe(
      "18014398509481986",
    );
  });
  it("rejects unsafe, unbounded and worthless price protection", () => {
    for (const value of ["0", "-1", "1.2", "01", "1e6", "18446744073709551616"])
      expect(() => minimumOutcomeUnits(value, "500000", 6)).toThrow();
    for (const price of ["0", "1000000", "1000001"])
      expect(() => minimumOutcomeUnits("5000000", price, 6)).toThrow();
    for (const decimals of [-1, 1.5, 19, NaN])
      expect(() =>
        minimumOutcomeUnits("5000000", "500000", decimals),
      ).toThrow();
    expect(() =>
      minimumOutcomeUnits("18446744073709551615", "1", 18),
    ).toThrow();
    expect(() => netOutputMeetsPriceCap("0", "5000000", "500000", 6)).toThrow();
  });
});
