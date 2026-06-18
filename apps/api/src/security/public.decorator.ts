import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_ROUTE = "isPublicRoute";

export function Public() {
  return SetMetadata(IS_PUBLIC_ROUTE, true);
}
