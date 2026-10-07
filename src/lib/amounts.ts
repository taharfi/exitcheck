export const SCALE = 1_000_000n;
export function decimalToMicro(value: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(value) || value.length > 40)
    throw new Error("Use a positive decimal with at most 6 decimal places.");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0"));
}
export function units(value: string): bigint {
  if (!/^\d{1,40}$/.test(value)) throw new Error("Invalid integer amount.");
  return BigInt(value);
}
export function decimal(value: string | bigint, places = 6): string {
  const n = typeof value === "bigint" ? value : units(value);
  const f = (n % SCALE)
    .toString()
    .padStart(6, "0")
    .slice(0, places)
    .replace(/0+$/, "");
  return `${n / SCALE}${f ? `.${f}` : ""}`;
}
export function money(value: string | null, places = 2): string {
  if (value === null) return "Not verified";
  const n = units(value);
  const whole = (n / SCALE).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${whole}.${(n % SCALE).toString().padStart(6, "0").slice(0, places)}`;
}
