export type LogCategory = "API" | "Workflow" | "Event" | "Audit" | "Security";

export function logStructured(category: LogCategory, message: string, context: Record<string, unknown> = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    category,
    message,
    ...context,
  };
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}
