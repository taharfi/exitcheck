const U64_MAX = (1n << 64n) - 1n;
function amount(value: string) {
  if (!/^(0|[1-9]\d{0,19})$/.test(value))
    throw Error("Invalid exact token amount.");
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed > U64_MAX)
    throw Error("Token amount outside supported range.");
  return parsed;
}

// USDC and micro-USD prices both have six decimals. The resulting floor must
// apply to NET tokens delivered to the owner, after any output-token fees.
// This computes a requirement; it does not verify or authorize a transaction.
export function minimumOutcomeUnits(
  totalUsdcInput: string,
  maximumPriceMicroUsd: string,
  outcomeDecimals: number,
) {
  const input = amount(totalUsdcInput);
  const price = amount(maximumPriceMicroUsd);
  if (price >= 1000000n)
    throw Error("Maximum outcome price must be below one dollar.");
  if (
    !Number.isInteger(outcomeDecimals) ||
    outcomeDecimals < 0 ||
    outcomeDecimals > 18
  )
    throw Error("Unsupported outcome decimals.");
  const units = (input * 10n ** BigInt(outcomeDecimals) + price - 1n) / price;
  if (units > U64_MAX) throw Error("Minimum output exceeds supported range.");
  return units.toString();
}

export function netOutputMeetsPriceCap(
  netMinimumOutput: string,
  totalUsdcInput: string,
  maximumPriceMicroUsd: string,
  outcomeDecimals: number,
) {
  return (
    amount(netMinimumOutput) >=
    BigInt(
      minimumOutcomeUnits(
        totalUsdcInput,
        maximumPriceMicroUsd,
        outcomeDecimals,
      ),
    )
  );
}
