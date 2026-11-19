import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./e2e',testMatch:[
  'partner-compliance-onboarding.spec.ts',
  'partner-workforce-credentials.spec.ts',
  'partner-agreements-work-orders-vehicles.spec.ts',
  'partner-mobilization-readiness.spec.ts',
  'syncfield-customer-qc.spec.ts'
],workers:1,timeout:240000,expect:{timeout:10000},reporter:'list',use:{baseURL:process.env.WEB_BASE_URL,browserName:'chromium',screenshot:'only-on-failure',trace:'retain-on-failure'},outputDir:'../test-results/partner-rehearsal'});
