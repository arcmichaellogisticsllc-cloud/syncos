import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';

export function normalizePaymentObservation(body: Record<string, unknown>, today: string) {
  const reference = (key: string) => {
    const value = body[key];
    if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(value)) throw new BadRequestException(`${key} must be a non-sensitive reference identifier`);
    return value;
  };
  const provider = reference('provider');
  const observed_status = reference('observed_status');
  if (!['passport','bank','other'].includes(provider) || !['pending','completed','failed','returned','reversed'].includes(observed_status)) throw new BadRequestException('Unsupported observation type');
  if (typeof body.amount !== 'string' || !/^(0|[1-9]\d{0,11})\.\d{2}$/.test(body.amount) || BigInt(body.amount.replace('.','')) <= 0n) throw new BadRequestException('Amount must be a positive decimal string in whole cents');
  if (typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency)) throw new BadRequestException('Currency is required');
  const date = body.completed_date == null ? null : String(body.completed_date);
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date || date > today)) throw new BadRequestException('Valid completed date is required');
  if (observed_status === 'completed' && !date) throw new BadRequestException('Completed observation requires completed date');
  const value = { provider, account_reference: reference('account_reference'), transaction_reference: reference('transaction_reference'), payee_reference: reference('payee_reference'), amount: body.amount, currency: body.currency, observed_status, completed_date: date };
  return { ...value, fingerprint: createHash('sha256').update(JSON.stringify(value)).digest('hex') };
}
