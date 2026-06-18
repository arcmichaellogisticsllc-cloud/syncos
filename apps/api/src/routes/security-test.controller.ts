import { Controller, Post } from "@nestjs/common";

@Controller("security-test")
export class SecurityTestController {
  @Post("missing-permission")
  missingPermissionMetadata() {
    return { shouldNotReach: true };
  }
}
