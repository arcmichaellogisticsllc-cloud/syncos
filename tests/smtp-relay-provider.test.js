const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("smtp_relay is a hosted email provider with STARTTLS and optional auth", () => {
  const helper = read("apps/api/src/email/smtp-relay.ts");
  const environment = read("apps/api/src/config/environment.ts");
  const scriptValidator = read("apps/api/scripts/validate-env.js");

  assert.match(environment, /"smtp_relay"/);
  assert.match(scriptValidator, /"smtp_relay"/);
  assert.match(helper, /requireTLS/);
  assert.match(helper, /SMTP_REQUIRE_TLS=true is required/);
  assert.match(helper, /SMTP_ADDRESS_FAMILY must be 4 or 6/);
  assert.match(helper, /SMTP_CLIENT_NAME/);
  assert.match(helper, /name: config\.clientName/);
  assert.match(helper, /forcedAddressFamilySocket/);
  assert.match(helper, /resolve4\(config\.host\)/);
  assert.match(helper, /SMTP_USERNAME.*SMTP_PASSWORD/s);
  assert.match(helper, /const auth = config\.username && config\.password/);
  assert.doesNotMatch(helper, /google_smtp/);
});

test("staging smtp_relay keeps recipient allowlist and Sync sender controls", () => {
  const environment = read("apps/api/src/config/environment.ts");
  const controller = read("apps/api/src/routes/partner-invitations.controller.ts");
  const template = read(".env.staging.example");

  assert.match(environment, /STAGING_EMAIL_RECIPIENT_ALLOWLIST is required in staging when EMAIL_PROVIDER=smtp_relay/);
  assert.match(environment, /synccommsystems\.com sender domain/);
  assert.match(controller, /stagingRecipientAllowlistFailure\(row\.email\)/);
  assert.match(controller, /delivery_reference = 'staging_recipient_blocked'/);
  assert.match(controller, /sendSmtpRelayEmail/);
  assert.match(controller, /delivery_reference = 'smtp_relay:accepted'/);
  assert.match(template, /EMAIL_PROVIDER=smtp_relay/);
  assert.match(template, /SMTP_HOST=smtp-relay\.gmail\.com/);
  assert.match(template, /SMTP_PORT=587/);
  assert.match(template, /SMTP_REQUIRE_TLS=true/);
  assert.match(template, /SMTP_ADDRESS_FAMILY=4/);
  assert.match(template, /SMTP_CLIENT_NAME=srv1818105\.synccommsystems\.com/);
  assert.match(template, /SMTP_USERNAME=\nSMTP_PASSWORD=/);
  assert.doesNotMatch(template, /EMAIL_API_KEY=<set-in-provider-secret-manager>/);
});

test("invitation URLs remain sourced from APPLICATION_BASE_URL without token logging", () => {
  const controller = read("apps/api/src/routes/partner-invitations.controller.ts");

  assert.match(controller, /const baseUrl = process\.env\.APPLICATION_BASE_URL/);
  assert.match(controller, /return `\$\{baseUrl\.replace\(\/\\\/\$\/, ""\)\}\/partner\/invite\/\$\{token\}`/);
  assert.doesNotMatch(controller, /console\.(log|error|warn)\([^)]*token/);
  assert.match(controller, /raw_token_returned: actionUrl !== null/);
});

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}
