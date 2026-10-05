import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';

export const FIELD_EVIDENCE_MAX_BYTES = 20 * 1024 * 1024;
export function decodeFieldEvidence(mime: string, encoded: string, maximumBytes=FIELD_EVIDENCE_MAX_BYTES) {
  if (encoded.length > 4 * Math.ceil(maximumBytes / 3) || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new BadRequestException(`File must be valid base64 and at most ${maximumBytes / 1048576} MiB`);
  }
  const bytes = Buffer.from(encoded, 'base64');
  const valid = mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : mime === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-'
    : ['image/heic','image/heif'].includes(mime) ? bytes.length>=12 && bytes.subarray(4,8).toString()==='ftyp' && ['heic','heix','hevc','hevx','mif1','msf1'].includes(bytes.subarray(8,12).toString())
    : mime === 'video/quicktime' ? bytes.length>=12 && bytes.subarray(4,8).toString()==='ftyp' && bytes.subarray(8,12).toString()==='qt  '
    : mime === 'video/mp4' ? bytes.length >= 12 && bytes.subarray(4, 8).toString() === 'ftyp' && !['heic','heix','hevc','hevx','mif1','msf1','qt  '].includes(bytes.subarray(8,12).toString()) : false;
  if (!valid || bytes.length > maximumBytes || bytes.toString('base64') !== encoded) {
    throw new BadRequestException(`Choose a JPEG, PNG, HEIC, HEIF, PDF, MP4, or MOV file up to ${maximumBytes / 1048576} MiB`);
  }
  return { bytes, checksum: createHash('sha256').update(bytes).digest('hex') };
}

export function assertEvidenceReplay(existing: Record<string, any>, candidate: Record<string, any>) {
  const timestamp=(value:any)=>value?new Date(value).toISOString():null;
  if(timestamp(existing.captured_at)!==timestamp(candidate.captured_at))throw new BadRequestException('Upload request identifier was already used with a different capture time');
  for (const key of ['daily_report_id', 'production_record_id', 'file_name', 'mime_type', 'description', 'checksum', 'evidence_kind', 'capture_location']) {
    if ((existing[key] ?? null) !== (candidate[key] ?? null)) {
      throw new BadRequestException('Upload request identifier was already used for different evidence; choose a new upload');
    }
  }
}
