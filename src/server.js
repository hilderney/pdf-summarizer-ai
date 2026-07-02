const path = require('path');
const { LlmSummarizerBuilder } = require('./pipeline/LlmSummarizerBuilder');
const phase1Api = require('./api');

async function main() {
  const app = LlmSummarizerBuilder.create()
    .fromPhase1Api(phase1Api)
    .outputTo(process.env.OUTPUT_DIR || './output')
    .withLogs(process.env.LOGS_DIR || './logs')
    .withPersistence('sqlite', { dbPath: process.env.DB_PATH || './data/app.db' })
    .withTokenEncryption({ keyEnv: 'APP_SECRET_KEY' })
    .registerLlmProviders(['ollama', 'openrouter'])
    .serve({
      port: Number(process.env.PORT || 4000),
      host: process.env.HOST || '127.0.0.1',
      staticDir: path.join(__dirname, '..', 'public'),
    })
    .build();

  await app.start();

  console.log(`PDF Summarizer AI — Fase 2`);
  console.log(`UI: ${app.url}`);
  console.log(`API: ${app.url}/api/v1/files`);

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
