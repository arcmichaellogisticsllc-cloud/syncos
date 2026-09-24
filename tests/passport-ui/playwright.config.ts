import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:'*.spec.ts',workers:1,timeout:60000,use:{baseURL:'http://127.0.0.1:3438',browserName:'chromium'},outputDir:'../../test-results/passport-ui'});
