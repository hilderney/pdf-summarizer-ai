const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { LinkerError } = require('../errors');
const { isPathInside } = require('../utils/paths');
const { listOutputFiles, getContentType } = require('./linker');
const { getRoots, browse } = require('./fsBrowser');
const { stagePdfFiles } = require('./stagingUpload');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('Invalid JSON body');
    error.statusCode = 400;
    throw error;
  }
}

async function serveStaticFile(res, staticDir, relativePath) {
  const safePath = relativePath.replace(/^\/+/, '');
  if (!isPathInside(staticDir, safePath)) {
    return sendJson(res, 400, { error: 'Invalid static path' });
  }

  const filePath = path.join(path.resolve(staticDir), safePath);

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    return res.end(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return sendJson(res, 404, { error: 'File not found' });
    }
    throw error;
  }
}

async function serveOutputFile(res, outputDir, requestedName) {
  if (!isPathInside(outputDir, requestedName)) {
    return sendJson(res, 400, { error: 'Invalid file path' });
  }

  const filePath = path.join(path.resolve(outputDir), requestedName);

  try {
    const content = await fs.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': getContentType(requestedName),
      'Content-Disposition': `inline; filename="${path.basename(requestedName)}"`,
    });
    return res.end(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return sendJson(res, 404, { error: 'File not found' });
    }
    throw error;
  }
}

function createPipelineController(phase1Api, config) {
  const { PdfSummarizerBuilder } = phase1Api;

  return {
    async scan(body) {
      const pdfs = await phase1Api.listPdfs(body.inputDir, { recursive: Boolean(body.recursive) });
      return { pdfs };
    },

    async extract(body) {
      const outputDir = body.outputDir || config.outputDir;
      const batch = await phase1Api.extractBatch(body.pdfPaths || [], outputDir, {
        overwrite: Boolean(body.overwrite),
      });
      return batch;
    },

    async export(body) {
      const outputDir = body.outputDir || config.outputDir;
      const formats = body.formats || ['csv', 'xlsx'];
      const exports = { csv: [], xlsx: [] };

      if (formats.includes('csv')) {
        for (const result of body.results || []) {
          exports.csv.push(await phase1Api.exportCsv([result], outputDir));
        }
      }

      if (formats.some((format) => ['xlsx', 'xls', 'excel'].includes(format))) {
        for (const result of body.results || []) {
          exports.xlsx.push(await phase1Api.exportXlsx([result], outputDir));
        }
      }

      return { exports };
    },

    async run(body) {
      const builder = PdfSummarizerBuilder.create()
        .fromDirectory(body.inputDir)
        .outputTo(body.outputDir || config.outputDir)
        .withLogs(body.logsDir || config.logsDir)
        .recursive(Boolean(body.recursive))
        .overwrite(body.overwrite !== false)
        .exportFormats(body.formats || ['csv', 'xlsx'])
        .withoutServer();

      const pipeline = builder.build();
      const summary = await pipeline.run();
      await pipeline.close();
      return summary;
    },
  };
}

function createAppRequestHandler(options) {
  const {
    outputDir,
    staticDir,
    baseUrl,
    phase1Api,
    llmModelService,
    llmProcessService,
    logsDir = './logs',
    stagingDir = './staging',
  } = options;

  const pipeline = createPipelineController(phase1Api, { outputDir, logsDir });

  return async (req, res) => {
    try {
      const url = new URL(req.url, baseUrl);
      const pathname = url.pathname;

      if (req.method === 'GET' && pathname === '/') {
        return serveStaticFile(res, staticDir, 'index.html');
      }

      if (req.method === 'GET' && (pathname.startsWith('/css/') || pathname.startsWith('/js/'))) {
        return serveStaticFile(res, staticDir, pathname.slice(1));
      }

      if (req.method === 'GET' && pathname === '/api/v1/files') {
        const files = await listOutputFiles(outputDir, baseUrl);
        return sendJson(res, 200, { files });
      }

      if (req.method === 'GET' && pathname === '/api/v1/fs/roots') {
        return sendJson(res, 200, await getRoots());
      }

      if (req.method === 'GET' && pathname === '/api/v1/fs/browse') {
        const targetPath = url.searchParams.get('path');
        if (!targetPath) {
          return sendJson(res, 400, { error: 'path query parameter is required' });
        }
        return sendJson(res, 200, await browse(targetPath));
      }

      if (pathname === '/api/v1/pipeline/stage' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const staged = await stagePdfFiles(body.files, stagingDir);
        return sendJson(res, 201, staged);
      }

      const openMatch = pathname.match(/^\/open\/(.+)$/);
      if (req.method === 'GET' && openMatch) {
        return serveOutputFile(res, outputDir, decodeURIComponent(openMatch[1]));
      }

      if (pathname.startsWith('/api/v1/pipeline/') && req.method === 'POST') {
        const body = await readJsonBody(req);
        const action = pathname.replace('/api/v1/pipeline/', '');

        if (action === 'scan') {
          return sendJson(res, 200, await pipeline.scan(body));
        }
        if (action === 'extract') {
          return sendJson(res, 200, await pipeline.extract(body));
        }
        if (action === 'export') {
          return sendJson(res, 200, await pipeline.export(body));
        }
        if (action === 'run') {
          return sendJson(res, 200, await pipeline.run(body));
        }

        return sendJson(res, 404, { error: 'Unknown pipeline action' });
      }

      if (pathname === '/api/v1/llm/models' && req.method === 'GET') {
        const provider = url.searchParams.get('provider') || undefined;
        const models = await llmModelService.list(provider ? { provider } : {});
        return sendJson(res, 200, { models });
      }

      if (pathname === '/api/v1/llm/models' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const model = await llmModelService.create(body);
        return sendJson(res, 201, model);
      }

      const modelMatch = pathname.match(/^\/api\/v1\/llm\/models\/([^/]+)(?:\/(health))?$/);
      if (modelMatch) {
        const modelId = modelMatch[1];
        const isHealth = modelMatch[2] === 'health';

        if (isHealth && req.method === 'POST') {
          const result = await llmModelService.healthCheck(modelId);
          return sendJson(res, 200, result);
        }

        if (req.method === 'GET') {
          const model = await llmModelService.get(modelId);
          if (!model) {
            return sendJson(res, 404, { error: 'Model not found' });
          }
          return sendJson(res, 200, model);
        }

        if (req.method === 'PUT') {
          const body = await readJsonBody(req);
          const model = await llmModelService.update(modelId, body);
          if (!model) {
            return sendJson(res, 404, { error: 'Model not found' });
          }
          return sendJson(res, 200, model);
        }

        if (req.method === 'DELETE') {
          try {
            const deleted = await llmModelService.remove(modelId);
            if (!deleted) {
              return sendJson(res, 404, { error: 'Model not found' });
            }
            res.writeHead(204);
            return res.end();
          } catch (error) {
            return sendJson(res, error.statusCode || 500, { error: error.message });
          }
        }
      }

      if (pathname === '/api/v1/llm/process' && req.method === 'POST') {
        const body = await readJsonBody(req);
        try {
          const result = await llmProcessService.processRequest(body);
          return sendJson(res, 201, result);
        } catch (error) {
          return sendJson(res, error.statusCode || 502, { error: error.message });
        }
      }

      if (pathname === '/api/v1/llm/jobs' && req.method === 'GET') {
        const jobs = await llmProcessService.listJobs();
        return sendJson(res, 200, { jobs });
      }

      const jobMatch = pathname.match(/^\/api\/v1\/llm\/jobs\/([^/]+)$/);
      if (jobMatch && req.method === 'GET') {
        const job = await llmProcessService.getJob(jobMatch[1]);
        if (!job) {
          return sendJson(res, 404, { error: 'Job not found' });
        }
        return sendJson(res, 200, job);
      }

      return sendJson(res, 404, { error: 'Route not found' });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return sendJson(res, statusCode, { error: error.message });
    }
  };
}

async function createAppServer(options = {}) {
  const {
    port = 4000,
    host = '127.0.0.1',
    outputDir = './output',
    staticDir = './public',
    logsDir = './logs',
    stagingDir = './staging',
    phase1Api,
    llmModelService,
    llmProcessService,
    httpImpl = http,
  } = options;

  if (!phase1Api || !llmModelService || !llmProcessService) {
    throw new LinkerError('phase1Api, llmModelService and llmProcessService are required');
  }

  const baseUrl = `http://${host}:${port}`;
  const handler = createAppRequestHandler({
    outputDir,
    staticDir,
    baseUrl,
    phase1Api,
    llmModelService,
    llmProcessService,
    logsDir,
    stagingDir,
  });

  const server = httpImpl.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      sendJson(res, 500, { error: error.message });
    });
  });

  const listeningPort = await new Promise((resolve, reject) => {
    server.once('error', (error) => {
      reject(new LinkerError(`Failed to start app server on port ${port}`, error));
    });
    server.listen(port, host, () => {
      const address = server.address();
      resolve(typeof address === 'object' ? address.port : port);
    });
  });

  const resolvedUrl = `http://${host}:${listeningPort}`;

  return {
    url: resolvedUrl,
    port: listeningPort,
    host,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(new LinkerError('Failed to close app server', error));
            return;
          }
          resolve();
        });
      }),
  };
}

module.exports = {
  createAppServer,
  createAppRequestHandler,
  readJsonBody,
};
