import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

async function main() {
const env = parse(readFileSync('.env.local'));
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:57321');
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const email = `${randomUUID()}@example.test`, password = randomUUID() + randomUUID();
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
assert.equal(created.error, null);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const events: unknown[] = [];
    Object.assign(window, { cspViolations: events });
    document.addEventListener('securitypolicyviolation', event => events.push({
      blockedURI: event.blockedURI, effectiveDirective: event.effectiveDirective,
      originalPolicy: event.originalPolicy,
    }));
  });
  const response = await page.goto('http://127.0.0.1:3117/shopping');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.waitForFunction(() => (window as unknown as { cspViolations: unknown[] }).cspViolations.length > 0);
  const violations = await page.evaluate(() => (window as unknown as { cspViolations: unknown[] }).cspViolations);
  writeFileSync('../.codex-artifacts/slice10/csp-baseline.json', JSON.stringify({
    policy: response?.headers()['content-security-policy'], violations,
  }, null, 2));
  console.log('Captured production sign-in CSP violation.');
} finally {
  await browser.close();
  assert.equal((await admin.auth.admin.deleteUser(created.data.user!.id)).error, null);
}
}
main().catch(error => { console.error(error); process.exitCode = 1; });
