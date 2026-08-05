import base from './playwright.config';

/**
 * The same tests, against a server the workflow already started.
 *
 * playwright.config.ts brings its own `webServer` running `npm run dev`, and
 * sets `reuseExistingServer: !process.env.CI` — so in CI it insists on
 * starting its own and collides with the production build the isolation step
 * needs running on the same port. A separate config is additive; editing the
 * shared one would change what happens on everybody's machine.
 */
export default {
  ...base,
  webServer: undefined,
  use: {
    ...base.use,
    baseURL: process.env.APP_URL || 'http://127.0.0.1:3000',
  },
};
