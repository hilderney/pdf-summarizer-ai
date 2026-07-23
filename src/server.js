const path = require('path');
const { loadEnv } = require('./loadEnv');
const { LlmSummarizerBuilder } = require('./pipeline/LlmSummarizerBuilder');

loadEnv();
const phase1Api = require('./api');

function resolvePersistenceConfig() {
  const type = (process.env.PERSISTENCE || 'sqlite').toLowerCase();
  if (type === 'mysql') {
    return {
      type: 'mysql',
      options: {
        host: process.env.MYSQL_HOST || '127.0.0.1',
        port: Number(process.env.MYSQL_PORT || 3306),
        user: process.env.MYSQL_USER || 'root',
        password: process.env.MYSQL_PASSWORD || '',
        database: process.env.MYSQL_DATABASE || 'pdf_summarizer',
      },
    };
  }
  return {
    type: 'sqlite',
    options: { dbPath: process.env.DB_PATH || './data/app.db' },
  };
}

async function main() {
  const persistence = resolvePersistenceConfig();
  const app = LlmSummarizerBuilder.create()
    .fromPhase1Api(phase1Api)
    .outputTo(process.env.OUTPUT_DIR || './output')
    .withLogs(process.env.LOGS_DIR || './logs')
    .withPersistence(persistence.type, persistence.options)
    .withTokenEncryption({ keyEnv: 'APP_SECRET_KEY' })
    .registerLlmProviders(['ollama', 'openrouter'])
    .serve({
      port: Number(process.env.PORT || 4000),
      host: process.env.HOST || '127.0.0.1',
      staticDir: path.join(__dirname, '..', 'public'),
    })
    .build();

  await app.start();

  console.log(`PDF Summarizer AI — Fase 6`);
  console.log(`UI: ${app.url}`);
  console.log(`Persistence: ${persistence.type}`);
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
