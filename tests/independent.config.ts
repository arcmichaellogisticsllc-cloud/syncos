import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'e2e',workers:1,timeout:90000,use:{baseURL:process.env.WEB_BASE_URL??'http://127.0.0.1:3458'},outputDir:'../test-results/independent'});
