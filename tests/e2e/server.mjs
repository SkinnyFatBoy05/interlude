import { createCompanion } from '../../src/server.mjs';

// Isolated CI fixture. Never reuse a user's live companion or operate native apps.
const app = await createCompanion({
  port: 4318,
  token: 'b'.repeat(64),
  nativeFocus: async () => ({ focused: true, message: 'Fixture return confirmed.' }),
  nativeDiagnostics: async () => ({ platform: process.platform, supported: true, helperReady: true, code: 'ready', message: 'Desktop helper fixture is ready.' }),
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
