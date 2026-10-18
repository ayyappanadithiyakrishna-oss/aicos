/** Shared number formatting so extracted `sourceText` matches the verifiable source text exactly. */
export function fmtNum(v: number, unit: string): string {
  if (unit === "%") return `${v}%`;
  if (unit === "USD/share") return `$${v}`;
  if (unit === "K") return `${v}K`;
  return `${v} ${unit}`.trim();
}
