import { BadRequestException } from '@nestjs/common';
export function directoryPage(query: Record<string, unknown>) {
  const parse = (value: unknown, fallback: number, name: string, minimum: number, maximum: number) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum || Number(value) > maximum) throw new BadRequestException(`${name} must be an integer between ${minimum} and ${maximum}`);
    return Number(value);
  };
  return {limit: parse(query.limit, 250, 'limit', 1, 250), offset: parse(query.offset, 0, 'offset', 0, Number.MAX_SAFE_INTEGER)};
}
