export type DomainEvent = {
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  actorUserId?: string;
  idempotencyKey?: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
};

export type CreateDomainEventInput = Omit<DomainEvent, "occurredAt"> & {
  occurredAt?: Date;
};

export function createDomainEvent(input: CreateDomainEventInput): DomainEvent {
  return {
    ...input,
    occurredAt: input.occurredAt ?? new Date(),
  };
}
