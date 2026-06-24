import fs from "node:fs";
import path from "node:path";

export type ManifestRecord = {
  objectType: string;
  id: string;
  name: string;
  route: string;
  routePattern: string;
  recommendedPersona: string;
};

export type E2EManifest = {
  tenant: { id: string; name: string };
  personas: Record<string, { userId: string; email: string; roleName: string }>;
  records: Record<string, ManifestRecord>;
};

export function readE2EManifest(): E2EManifest {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/e2e/fixtures/e2e-demo-records.json"), "utf8")) as E2EManifest;
}
