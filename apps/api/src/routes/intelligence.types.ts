import type { Request } from "express";

export type AuthenticatedRequest = Request & {
  auth: {
    tenantId: string;
    userId: string;
  };
};

export function pick(input: Record<string, unknown>, allowed: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => allowed.includes(key) && value !== undefined));
}

export function requireString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(message);
  }
  return value.trim();
}

export function requireOne(values: unknown[], message: string): void {
  if (!values.some((value) => typeof value === "string" && value.trim())) {
    throw new Error(message);
  }
}

export function optionalScore(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`${field} must be between 0 and 100`);
  }
  return parsed;
}

export function positiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return parsed;
}

export function requireAllowed(value: unknown, allowed: Set<string>, field: string): string {
  const text = requireString(value, `${field} is required`);
  if (!allowed.has(text)) {
    throw new Error(`${field} is invalid`);
  }
  return text;
}
