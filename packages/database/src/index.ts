export type TenantScopedRecord = {
  id: string;
  tenantId: string;
  createdAt: Date;
  updatedAt?: Date;
  deletedAt?: Date | null;
};

export * from "./tenant-repository";
