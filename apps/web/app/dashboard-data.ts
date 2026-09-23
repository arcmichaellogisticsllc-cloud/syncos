export type DashboardData = Record<string, unknown>;

export function valueAt(data: DashboardData | null, path: string, fallback: unknown = 0): unknown {
  if (!data) return fallback;
  return path.split(".").reduce<unknown>((current, key) => {
    if (current && typeof current === "object" && key in current) {
      return (current as Record<string, unknown>)[key];
    }
    return fallback;
  }, data);
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "0";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(4);
  if (typeof value === "string") return value;
  if (typeof value === "object" && "currentValue" in value) return formatValue((value as { currentValue?: unknown }).currentValue);
  return JSON.stringify(value);
}
