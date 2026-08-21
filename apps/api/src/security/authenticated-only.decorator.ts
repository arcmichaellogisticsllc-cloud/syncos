import { SetMetadata } from "@nestjs/common";

export const AUTHENTICATED_ONLY_ROUTE = "syncos:authenticated_only_route";

export const AuthenticatedOnly = () => SetMetadata(AUTHENTICATED_ONLY_ROUTE, true);
