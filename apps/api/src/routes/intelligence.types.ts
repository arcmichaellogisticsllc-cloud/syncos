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
