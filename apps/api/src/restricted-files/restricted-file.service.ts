import { BadRequestException, Injectable } from "@nestjs/common";
import { mkdir, unlink, writeFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { PoolClient } from "pg";
import { calculateRestrictedFileSha256, resolveRestrictedStoragePath, sanitizeRestrictedFileName, restrictedFileExtensionForMime, detectRestrictedFileMime } from "./restricted-file.primitives";

@Injectable()
export class RestrictedFileService {
  async readRestrictedFile(file: { storage_key: string }) {
    const root = process.env.SYNCOS_RESTRICTED_FILE_STORAGE_DIR ?? "/private/tmp/syncos-restricted-files";
    const fullPath = resolveRestrictedStoragePath(root, file.storage_key);
    return readFile(fullPath);
  }

  async createRestrictedFileObject(params: { client: PoolClient; tenantId: string; organizationId: string; capacityProviderId: string; actorUserId: string; category: string; relatedEntityType: string; relatedEntityId: string; raw: Record<string, unknown>; maxSize: number; allowedMimes: Set<string> }) {
    const fileName = sanitizeRestrictedFileName(String(params.raw.file_name ?? ""));
    const requestedMime = String(params.raw.mime_type ?? params.raw.content_type ?? "");
    const contentBase64 = String(params.raw.content_base64 ?? "");
    const buffer = Buffer.from(contentBase64, "base64");
    if (!buffer.length || buffer.length > params.maxSize) throw new BadRequestException("file size is outside permitted limits");
    const detectedMime = detectRestrictedFileMime(buffer);
    if (!params.allowedMimes.has(detectedMime) || detectedMime !== requestedMime) throw new BadRequestException("file content type is not supported");
    const checksum = calculateRestrictedFileSha256(buffer);
    const storageKey = `${params.tenantId}/${params.organizationId}/${randomUUID()}${restrictedFileExtensionForMime(detectedMime)}`;
    const fullPath = resolveRestrictedStoragePath(process.env.SYNCOS_RESTRICTED_FILE_STORAGE_DIR ?? "/private/tmp/syncos-restricted-files", storageKey);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, buffer, { flag: "wx" });
    try {
      const result = await params.client.query(`INSERT INTO partner_restricted_file_objects (tenant_id, organization_id, capacity_provider_id, category, related_entity_type, related_entity_id, file_name, mime_type, size_bytes, checksum, storage_key, uploaded_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [params.tenantId, params.organizationId, params.capacityProviderId, params.category, params.relatedEntityType, params.relatedEntityId, fileName, detectedMime, buffer.length, checksum, storageKey, params.actorUserId]);
      return { file: result.rows[0], storageKey };
    } catch (error) { await unlink(fullPath).catch(() => undefined); throw error; }
  }
}
