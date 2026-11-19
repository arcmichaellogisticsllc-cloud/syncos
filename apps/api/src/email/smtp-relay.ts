import {logStructured} from "../instrumentation/structured-logger";
import { resolve4, resolve6 } from "node:dns/promises";
import * as net from "node:net";
import * as nodemailer from "nodemailer";

type Env = Pick<NodeJS.ProcessEnv, "SMTP_HOST" | "SMTP_PORT" | "SMTP_SECURE" | "SMTP_REQUIRE_TLS" | "SMTP_USERNAME" | "SMTP_PASSWORD" | "SMTP_ADDRESS_FAMILY" | "SMTP_CLIENT_NAME">;

export type SmtpRelayConfig = {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  username?: string;
  password?: string;
  addressFamily?: 4 | 6;
  clientName?: string;
};

export type SmtpRelayMessage = {
  from: string;
  replyTo?: string;
  to: string;
  subject: string;
  text: string;
};

export type SmtpRelaySendResult = {
  messageId?: string;
  response?: string;
  accepted?: unknown[];
  rejected?: unknown[];
};

export type SmtpRelayTransport = {
  sendMail(message: SmtpRelayMessage): Promise<SmtpRelaySendResult>;
};

export function buildSmtpRelayConfig(env: Partial<Env> = process.env): SmtpRelayConfig {
  const host = required(env.SMTP_HOST, "SMTP_HOST");
  const port = parsePort(env.SMTP_PORT);
  const secure = parseBoolean(env.SMTP_SECURE, false, "SMTP_SECURE");
  const requireTLS = parseBoolean(env.SMTP_REQUIRE_TLS, true, "SMTP_REQUIRE_TLS");
  const username = env.SMTP_USERNAME?.trim() || undefined;
  const password = env.SMTP_PASSWORD?.trim() || undefined;
  const addressFamily = parseAddressFamily(env.SMTP_ADDRESS_FAMILY);
  const clientName = env.SMTP_CLIENT_NAME?.trim() || undefined;

  if (username && !password) throw new Error("SMTP_PASSWORD is required when SMTP_USERNAME is set");
  if (password && !username) throw new Error("SMTP_USERNAME is required when SMTP_PASSWORD is set");
  if (!requireTLS) throw new Error("SMTP_REQUIRE_TLS=true is required for smtp_relay");

  return { host, port, secure, requireTLS, username, password, addressFamily, clientName };
}

export async function sendSmtpRelayEmail(message: SmtpRelayMessage, env: Partial<Env> = process.env, transportFactory = createSmtpTransport): Promise<SmtpRelaySendResult> {
  validateConfiguredAddress(message.from, "EMAIL_FROM");
  if (message.replyTo) validateConfiguredAddress(message.replyTo, "EMAIL_REPLY_TO");
  const transport = transportFactory(buildSmtpRelayConfig(env));
  try {
    const result = await transport.sendMail(message);
    logStructured("Workflow", "smtp_submission", smtpReceipt(result));
    return result;
  } catch (error) {
    logStructured("Workflow", "smtp_submission_failed", smtpFailureReceipt(error));
    throw error;
  }
}

export function createSmtpTransport(config: SmtpRelayConfig): SmtpRelayTransport {
  const auth = config.username && config.password ? { auth: { user: config.username, pass: config.password } } : {};
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    ...(config.clientName ? { name: config.clientName } : {}),
    secure: config.secure,
    requireTLS: config.requireTLS,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    disableFileAccess: true,
    disableUrlAccess: true,
    ...(config.addressFamily ? { getSocket: forcedAddressFamilySocket(config) } : {}),
    tls: {
      minVersion: "TLSv1.2",
      servername: config.host,
    },
    ...auth,
  });
}

function forcedAddressFamilySocket(config: SmtpRelayConfig) {
  return async (_options: unknown, callback: (error: Error | null, options?: { connection: net.Socket; host: string; servername: string }) => void) => {
    try {
      const addresses = config.addressFamily === 4 ? await resolve4(config.host) : await resolve6(config.host);
      const host = addresses[0];
      if (!host) throw new Error(`SMTP_HOST did not resolve IPv${config.addressFamily}`);
      const connection = net.connect({ host, port: config.port, family: config.addressFamily });
      let settled = false;
      connection.once("connect", () => {
        settled = true;
        callback(null, { connection, host, servername: config.host });
      });
      connection.once("error", (error) => {
        if (!settled) callback(error);
      });
    } catch (error) {
      callback(error as Error);
    }
  };
}

export function validateConfiguredAddress(value: string, fieldName: string) {
  const email = extractEmailAddress(value);
  if (!email.endsWith("@synccommsystems.com")) {
    throw new Error(`${fieldName} must use a synccommsystems.com sender domain`);
  }
}

function extractEmailAddress(value: string) {
  const trimmed = required(value, "email address").trim().toLowerCase();
  const bracketMatch = trimmed.match(/<([^<>@\s]+@[^<>@\s]+)>$/);
  if (bracketMatch) return bracketMatch[1];
  if (/^[^@\s<>]+@[^@\s<>]+$/.test(trimmed)) return trimmed;
  throw new Error("email address must be a configured mailbox or display-name address");
}

function required(value: string | undefined, name: string) {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function parsePort(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error("SMTP_PORT must be an integer from 1 to 65535");
  return parsed;
}

function parseBoolean(value: string | undefined, defaultValue: boolean, name: string) {
  if (value === undefined || value === "") return defaultValue;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function parseAddressFamily(value: string | undefined): 4 | 6 | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  if (value.trim() === "4") return 4;
  if (value.trim() === "6") return 6;
  throw new Error("SMTP_ADDRESS_FAMILY must be 4 or 6");
}

// Keep provider identifiers and numeric reply codes, never message bodies, recipient
// addresses, reset links, credentials or free-form provider error text.
export function smtpReceipt(result: SmtpRelaySendResult) {
  const reply = smtpReply(result.response);
  return {
    messageId: result.messageId && /^[<>a-zA-Z0-9@._+-]{1,255}$/.test(result.messageId) ? result.messageId : null,
    ...reply,
    acceptedCount: Array.isArray(result.accepted) ? result.accepted.length : null,
    rejectedCount: Array.isArray(result.rejected) ? result.rejected.length : null,
    deliveryStatus: "submission_only",
  };
}

function smtpReply(response:unknown) {
  const value=typeof response === "string" ? response.slice(0,1000) : "";
  const match=value.match(/^([245]\d{2})(?:[ -]([245]\.\d{1,3}\.\d{1,3}))?/);
  const queue=value.match(/\bqueued as ([A-Za-z0-9._-]{1,128})(?:\s|$)/i)?.[1]
    ?? value.match(/\bOK\s+([A-Za-z0-9._-]{1,128})\s+-\s+gsmtp$/)?.[1];
  return {responseCode:match ? Number(match[1]) : null,enhancedStatus:match?.[2]??null,providerQueueId:queue??null};
}
export function smtpFailureReceipt(error:unknown) {
  const e=(error??{}) as {responseCode?:number;response?:string;code?:string;command?:string};
  const reply=smtpReply(e.response);
  const responseCode=Number.isInteger(e.responseCode)&&e.responseCode!>=400&&e.responseCode!<=599 ? e.responseCode! : reply.responseCode;
  const failureClass=["ETIMEDOUT","ECONNECTION","ESOCKET","EAUTH","EENVELOPE","EMESSAGE"].includes(e.code??"") ? e.code! : "unknown";
  const command=["CONN","EHLO","HELO","STARTTLS","AUTH","MAIL FROM","RCPT TO","DATA"].includes(e.command??"") ? e.command! : "unknown";
  return {...reply,responseCode,failureClass,command,safeToRetry:(responseCode!==null&&responseCode>=400&&responseCode<500)||
    (command==="CONN"&&["ETIMEDOUT","ECONNECTION","ESOCKET"].includes(failureClass))};
}
