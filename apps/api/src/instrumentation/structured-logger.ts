const secretKey=/(password|passwd|authorization|cookie|secret|token|private.?key|bank.?account|routing.?number|content_base64)/i;
export function redactLogContext(value:unknown,depth=0):unknown{
 if(depth>8)return '[depth limit]';
 if(Array.isArray(value))return value.slice(0,100).map(x=>redactLogContext(x,depth+1));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,100).map(([key,v])=>[key,secretKey.test(key)?'[redacted]':redactLogContext(v,depth+1)]));
 if(typeof value==='string')return value.replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi,'Bearer [redacted]').slice(0,4000);
 return value;
}
export type LogCategory = "API" | "Workflow" | "Event" | "Audit" | "Security";

export function logStructured(category: LogCategory, message: string, context: Record<string, unknown> = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    category,
    message,
    ...(redactLogContext(context) as Record<string,unknown>),
  };
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}
