import { describe, it, expect } from "vitest";
import {
  calculateExit,
  assertFresh,
} from "../../src/features/exits/calculations";
import { decimalToMicro, decimal } from "../../src/lib/amounts";
const capturedAt = Date.now();
const depth = {
  capturedAt,
  yes: [
    { price: "500000", quantity: "2000000" },
    { price: "700000", quantity: "1000000" },
    { price: "600000", quantity: "2000000" },
  ],
  no: [{ price: "300000", quantity: "10000000" }],
};
const base = {
  quantity: "4000000",
  held: "10000000",
  isYes: true,
  depth,
  referencePrice: "700000",
};
describe("deterministic exit calculations", () => {
  it("separates size impact from mark valuation and excludes zero-size levels", () => {
    const first = calculateExit({
      ...base,
      referencePrice: "800000",
      depth: {
        ...depth,
        yes: [...depth.yes, { price: "999999", quantity: "0" }],
      },
    });
    const second = calculateExit({ ...base, referencePrice: "600000" });
    expect(first.impactReferencePrice).toBe("700000");
    expect(first.impactBps).toBe(second.impactBps);
    expect(first.referenceValue).toBe("3200000");
    expect(second.referenceValue).toBe("2400000");
  });
  it("walks multiple bid levels highest first", () => {
    const e = calculateExit(base);
    expect(e.gross).toBe("2400000");
    expect(e.averagePrice).toBe("600000");
    expect(e.remaining).toBe("6000000");
    expect(e.insufficient).toBe(false);
    expect(e.referenceValue).toBe("2800000");
  });
  it("does not complement the NO bids or accidentally use YES", () => {
    expect(calculateExit({ ...base, isYes: false }).gross).toBe("1200000");
  });
  it("reports partial depth and remaining position after supported fill", () => {
    const e = calculateExit({ ...base, quantity: "9000000" });
    expect(e.fillable).toBe("5000000");
    expect(e.gross).toBe("2900000");
    expect(e.remaining).toBe("5000000");
    expect(e.insufficient).toBe(true);
  });
  it("does not invent fees or net proceeds", () => {
    const e = calculateExit(base);
    expect(e.fee).toBeNull();
    expect(e.net).toBeNull();
  });
  it("deducts known fees precisely", () => {
    expect(calculateExit({ ...base, fee: "12345" }).net).toBe("2387655");
  });
  it("rounds combined fractional gross down once", () => {
    const e = calculateExit({
      ...base,
      quantity: "3",
      depth: {
        capturedAt,
        yes: [
          { price: "500001", quantity: "1" },
          { price: "500000", quantity: "2" },
        ],
        no: [],
      },
    });
    expect(e.gross).toBe("1");
  });
  it.each(["0", "-1", "1.5", "10000001", "NaN"])(
    "rejects invalid/excess quantity %s",
    (quantity) => expect(() => calculateExit({ ...base, quantity })).toThrow(),
  );
  it("rejects stale snapshots", () =>
    expect(() => assertFresh(capturedAt, capturedAt + 20001)).toThrow(
      "expired",
    ));
  it("rejects future snapshots", () =>
    expect(() => assertFresh(capturedAt, capturedAt - 1001)).toThrow(
      "expired",
    ));
  it("rejects malformed prices and impossible fees", () => {
    expect(() =>
      calculateExit({
        ...base,
        depth: {
          capturedAt,
          yes: [{ price: "1000001", quantity: "10000000" }],
          no: [],
        },
      }),
    ).toThrow();
    expect(() => calculateExit({ ...base, fee: "999999999" })).toThrow();
  });
  it("converts scale without floating-point arithmetic", () => {
    expect(decimalToMicro("5.777773")).toBe(5777773n);
    expect(decimal(5777773n)).toBe("5.777773");
    expect(decimalToMicro("9007199254740993.000001")).toBe(
      9007199254740993000001n,
    );
    expect(() => decimalToMicro("0.0000001")).toThrow();
  });
});
