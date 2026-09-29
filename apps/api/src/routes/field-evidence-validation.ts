import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';

export const FIELD_EVIDENCE_MAX_BYTES = 20 * 1024 * 1024;
export function decodeFieldEvidence(mime: string, encoded: string) {
  if (encoded.length > 4 * Math.ceil(FIELD_EVIDENCE_MAX_BYTES / 3) || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new BadRequestException('File must be valid base64 and at most 20 MB');
  }
  const bytes = Buffer.from(encoded, 'base64');
  const valid = mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : mime === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-'
    : mime === 'video/mp4' ? bytes.length >= 12 && bytes.subarray(4, 8).toString() === 'ftyp' : false;
  if (!valid || bytes.length > FIELD_EVIDENCE_MAX_BYTES || bytes.toString('base64') !== encoded) {
    throw new BadRequestException('Choose a JPEG, PNG, PDF, or MP4 file up to 20 MB');
  }
  return { bytes, checksum: createHash('sha256').update(bytes).digest('hex') };
}

export function assertEvidenceReplay(existing: Record<string, any>, candidate: Record<string, any>) {
  for (const key of ['daily_report_id', 'production_record_id', 'file_name', 'mime_type', 'description', 'checksum']) {
    if ((existing[key] ?? null) !== (candidate[key] ?? null)) {
      throw new BadRequestException('Upload request identifier was already used for different evidence; choose a new upload');
    }
  }
}
