import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:'company-field.browser.ts',workers:1,timeout:30000,use:{baseURL:'http://127.0.0.1:3458',browserName:'chromium'},outputDir:'../test-results/company-field'});
