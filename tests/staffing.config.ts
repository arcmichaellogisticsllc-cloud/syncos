import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:'staffing.browser.ts',workers:1,timeout:240000,reporter:'list',use:{baseURL:process.env.WEB_BASE_URL,browserName:'chromium',screenshot:'only-on-failure',trace:'retain-on-failure'},outputDir:'../test-results/staffing'});
