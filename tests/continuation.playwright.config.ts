import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'e2e',testMatch:'syncfield-daily-production.spec.ts',workers:1,timeout:90000,expect:{timeout:15000},use:{baseURL:'http://127.0.0.1:3448',browserName:'chromium',actionTimeout:15000,trace:'retain-on-failure'},outputDir:'../test-results/continuation'});
