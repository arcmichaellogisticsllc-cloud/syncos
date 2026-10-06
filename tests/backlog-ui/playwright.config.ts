import {defineConfig} from '@playwright/test';
export default defineConfig({reporter:[['list'],['junit',{outputFile:'test-results/backlog-ui-junit.xml'}]],testDir:'.',testMatch:'*.spec.ts',workers:1,timeout:60000,use:{screenshot:'only-on-failure',trace:'retain-on-failure',baseURL:process.env.WEB_BASE_URL??'http://127.0.0.1:3448',browserName:'chromium'},outputDir:'../../test-results/backlog-ui'});
