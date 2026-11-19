import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import path from "node:path";

export const restrictedFileMimeExtensions = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
} as const;

export function sanitizeRestrictedFileName(value: string): string {
  const safe = path.basename(value).replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 120);
  if (!safe || safe === "." || safe === "..") throw new BadRequestException("file_name is invalid");
  return safe;
}

export function detectRestrictedFileMime(buffer: Buffer): string {
  if (buffer.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP") return "image/webp";
  throw new BadRequestException("unsupported file content");
}

export function restrictedFileExtensionForMime(mime: string): string {
  return restrictedFileMimeExtensions[mime as keyof typeof restrictedFileMimeExtensions] ?? "";
}

export function calculateRestrictedFileSha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function resolveRestrictedStoragePath(root: string, storageKey: string): string {
  if (!storageKey || path.isAbsolute(storageKey)) throw new Error("storage key is invalid");
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...storageKey.split("/"));
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("storage key is invalid");
  return resolved;
}
