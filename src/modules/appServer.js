const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { LinkerError } = require('../errors');
const { isPathInside } = require('../utils/paths');
const { listOutputFiles, getContentType, deleteOutputFile } = require('./linker');
const { getRoots, browse } = require('./fsBrowser');
const { stagePdfFiles, stageInputFiles } = require('./stagingUpload');
const { processInputFiles } = require('./inputProcessService');
const { importSpreadsheet, listSpreadsheets } = require('./spreadsheetImporter');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
};

const DEFAULT_FORMATS = ['csv', 'xlsx'];

// Returned by route handlers that matched the path but not the HTTP method,
// so the main dispatcher keeps trying later routes (preserving fall-through).
const NOT_HANDLED = Symbol('route-not-handled');

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendError(res, error) {
  const statusCode = error.statusCode || 500;
  sendJson(res, statusCode, {
    error: error.message,
    ...(error.code ? { code: error.code } : {}),
  });
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
      return phase1Api.extractBatch(body.pdfPaths || [], outputDir, {
        overwrite: Boolean(body.overwrite),
      });
    },

    async export(body) {
      const outputDir = body.outputDir || config.outputDir;
      const formats = body.formats || DEFAULT_FORMATS;
      const results = body.results || [];
      const exports = { csv: [], xlsx: [] };

      if (formats.includes('csv')) {
        for (const result of results) {
          exports.csv.push(await phase1Api.exportCsv([result], outputDir));
        }
      }

      if (formats.some((format) => ['xlsx', 'xls', 'excel'].includes(format))) {
        for (const result of results) {
          exports.xlsx.push(await phase1Api.exportXlsx([result], outputDir));
        }
      }

      return { exports };
    },

    async run(body) {
      const pipeline = PdfSummarizerBuilder.create()
        .fromDirectory(body.inputDir)
        .outputTo(body.outputDir || config.outputDir)
        .withLogs(body.logsDir || config.logsDir)
        .recursive(Boolean(body.recursive))
        .overwrite(body.overwrite !== false)
        .exportFormats(body.formats || DEFAULT_FORMATS)
        .withoutServer()
        .build();

      const summary = await pipeline.run();
      await pipeline.close();
      return summary;
    },
  };
}

async function handleDeleteFile(ctx, res, requestedName) {
  try {
    const result = await deleteOutputFile(ctx.outputDir, requestedName);
    return sendJson(res, 200, result);
  } catch (error) {
    return sendJson(res, error.statusCode || 500, { error: error.message });
  }
}

async function handleFsBrowse(res, url) {
  const targetPath = url.searchParams.get('path');
  if (!targetPath) {
    return sendJson(res, 400, { error: 'path query parameter is required' });
  }
  return sendJson(res, 200, await browse(targetPath));
}

async function handleInputStage(ctx, req, res) {
  const body = await readJsonBody(req);
  if (!Array.isArray(body.files) || body.files.length === 0) {
    return sendJson(res, 400, { error: 'files array is required' });
  }
  const staged = await stageInputFiles(body.files, ctx.stagingDir);
  return sendJson(res, 201, staged);
}

async function handleInputProcess(ctx, req, res) {
  const body = await readJsonBody(req);
  if (!body.inputDir || !Array.isArray(body.files) || body.files.length === 0) {
    return sendJson(res, 400, { error: 'inputDir and files are required' });
  }

  for (const fileName of body.files) {
    if (!isPathInside(body.inputDir, fileName)) {
      return sendJson(res, 400, { error: 'Invalid file path' });
    }
  }

  const summary = await processInputFiles(body.inputDir, body.files, {
    outputDir: body.outputDir || ctx.outputDir,
    logsDir: body.logsDir || ctx.logsDir,
    phase1Api: ctx.phase1Api,
    baseUrl: ctx.baseUrl,
    overwrite: body.overwrite !== false,
  });
  return sendJson(res, 200, summary);
}

async function handleInputRun(ctx, req, res) {
  const body = await readJsonBody(req);
  if (!Array.isArray(body.files) || body.files.length === 0) {
    return sendJson(res, 400, { error: 'files array is required' });
  }

  const staged = await stageInputFiles(body.files, ctx.stagingDir);
  const fileNames = body.processNames?.length
    ? body.processNames.filter((name) => staged.files.some((file) => file.name === name))
    : staged.files.map((file) => file.name);

  const summary = await processInputFiles(staged.inputDir, fileNames, {
    outputDir: body.outputDir || ctx.outputDir,
    logsDir: body.logsDir || ctx.logsDir,
    phase1Api: ctx.phase1Api,
    baseUrl: ctx.baseUrl,
    overwrite: body.overwrite !== false,
  });

  return sendJson(res, 201, { ...summary, staged });
}

async function handleSpreadsheetScan(ctx, req, res) {
  const body = await readJsonBody(req);
  const files = await listSpreadsheets(body.inputDir || ctx.inputDir, {
    recursive: Boolean(body.recursive),
  });
  return sendJson(res, 200, { files });
}

async function handleSpreadsheetImport(ctx, req, res) {
  const body = await readJsonBody(req);
  if (!body.sourceFile) {
    return sendJson(res, 400, { error: 'sourceFile is required' });
  }

  const targetInputDir = body.inputDir || ctx.inputDir;
  if (!isPathInside(targetInputDir, body.sourceFile)) {
    return sendJson(res, 400, { error: 'Invalid file path' });
  }

  try {
    const result = await importSpreadsheet(body.sourceFile, {
      inputDir: targetInputDir,
      outputDir: body.outputDir || ctx.outputDir,
      formats: body.formats || DEFAULT_FORMATS,
      overwrite: body.overwrite !== false,
      logsDir: body.logsDir || ctx.logsDir,
      baseUrl: ctx.baseUrl,
    });
    return sendJson(res, 201, result);
  } catch (error) {
    if (error.code === 'NOT_FOUND' || error.cause?.code === 'ENOENT') {
      return sendJson(res, 404, { error: error.message });
    }
    throw error;
  }
}

async function handlePipelineAction(ctx, req, res, pathname) {
  const body = await readJsonBody(req);
  const action = pathname.replace('/api/v1/pipeline/', '');
  const runner = ctx.pipeline[action];

  if (!runner || !['scan', 'extract', 'export', 'run'].includes(action)) {
    return sendJson(res, 404, { error: 'Unknown pipeline action' });
  }

  return sendJson(res, 200, await runner(body));
}

async function handleModelRoute(ctx, req, res, modelMatch) {
  const modelId = modelMatch[1];
  const isHealth = modelMatch[2] === 'health';

  if (isHealth && req.method === 'POST') {
    return sendJson(res, 200, await ctx.llmModelService.healthCheck(modelId));
  }

  if (req.method === 'GET') {
    const model = await ctx.llmModelService.get(modelId);
    return model
      ? sendJson(res, 200, model)
      : sendJson(res, 404, { error: 'Model not found' });
  }

  if (req.method === 'PUT') {
    const body = await readJsonBody(req);
    const model = await ctx.llmModelService.update(modelId, body);
    return model
      ? sendJson(res, 200, model)
      : sendJson(res, 404, { error: 'Model not found' });
  }

  if (req.method === 'DELETE') {
    try {
      const deleted = await ctx.llmModelService.remove(modelId);
      if (!deleted) {
        return sendJson(res, 404, { error: 'Model not found' });
      }
      res.writeHead(204);
      return res.end();
    } catch (error) {
      return sendJson(res, error.statusCode || 500, { error: error.message });
    }
  }

  return NOT_HANDLED;
}

async function handleLlmProcess(ctx, req, res) {
  const body = await readJsonBody(req);
  try {
    const result = await ctx.llmProcessService.processRequest(body);
    return sendJson(res, 201, result);
  } catch (error) {
    return sendJson(res, error.statusCode || 502, {
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
  }
}

function routeRequest(ctx, req, res, url) {
  const { pathname } = url;
  const isGet = req.method === 'GET';
  const isPost = req.method === 'POST';

  if (isGet && pathname === '/') {
    return serveStaticFile(res, ctx.staticDir, 'index.html');
  }

  if (isGet && (pathname.startsWith('/css/') || pathname.startsWith('/js/'))) {
    return serveStaticFile(res, ctx.staticDir, pathname.slice(1));
  }

  if (isGet && pathname === '/api/v1/files') {
    return listOutputFiles(ctx.outputDir, ctx.baseUrl).then((files) => sendJson(res, 200, { files }));
  }

  const deleteFileMatch = pathname.match(/^\/api\/v1\/files\/(.+)$/);
  if (req.method === 'DELETE' && deleteFileMatch) {
    return handleDeleteFile(ctx, res, decodeURIComponent(deleteFileMatch[1]));
  }

  if (isGet && pathname === '/api/v1/fs/roots') {
    return getRoots().then((roots) => sendJson(res, 200, roots));
  }

  if (isGet && pathname === '/api/v1/fs/browse') {
    return handleFsBrowse(res, url);
  }

  if (isPost && pathname === '/api/v1/pipeline/stage') {
    return readJsonBody(req).then((body) =>
      stagePdfFiles(body.files, ctx.stagingDir).then((staged) => sendJson(res, 201, staged)),
    );
  }

  const openMatch = pathname.match(/^\/open\/(.+)$/);
  if (isGet && openMatch) {
    return serveOutputFile(res, ctx.outputDir, decodeURIComponent(openMatch[1]));
  }

  if (isPost && pathname === '/api/v1/input/stage') {
    return handleInputStage(ctx, req, res);
  }

  if (isPost && pathname === '/api/v1/input/process') {
    return handleInputProcess(ctx, req, res);
  }

  if (isPost && pathname === '/api/v1/input/run') {
    return handleInputRun(ctx, req, res);
  }

  if (isPost && pathname === '/api/v1/spreadsheet/scan') {
    return handleSpreadsheetScan(ctx, req, res);
  }

  if (isPost && pathname === '/api/v1/spreadsheet/import') {
    return handleSpreadsheetImport(ctx, req, res);
  }

  if (isPost && pathname.startsWith('/api/v1/pipeline/')) {
    return handlePipelineAction(ctx, req, res, pathname);
  }

  if (isGet && pathname === '/api/v1/llm/models') {
    const provider = url.searchParams.get('provider') || undefined;
    return ctx.llmModelService
      .list(provider ? { provider } : {})
      .then((models) => sendJson(res, 200, { models }));
  }

  if (isPost && pathname === '/api/v1/llm/models') {
    return readJsonBody(req)
      .then((body) => ctx.llmModelService.create(body))
      .then((model) => sendJson(res, 201, model));
  }

  const modelMatch = pathname.match(/^\/api\/v1\/llm\/models\/([^/]+)(?:\/(health))?$/);
  if (modelMatch) {
    return handleModelRoute(ctx, req, res, modelMatch).then((result) =>
      result === NOT_HANDLED ? sendJson(res, 404, { error: 'Route not found' }) : result,
    );
  }

  if (isPost && pathname === '/api/v1/llm/process') {
    return handleLlmProcess(ctx, req, res);
  }

  if (isGet && pathname === '/api/v1/llm/jobs') {
    return ctx.llmProcessService.listJobs().then((jobs) => sendJson(res, 200, { jobs }));
  }

  const jobMatch = pathname.match(/^\/api\/v1\/llm\/jobs\/([^/]+)$/);
  if (isGet && jobMatch) {
    return ctx.llmProcessService.getJob(jobMatch[1]).then((job) =>
      job ? sendJson(res, 200, job) : sendJson(res, 404, { error: 'Job not found' }),
    );
  }

  return sendJson(res, 404, { error: 'Route not found' });
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
    inputDir = process.env.INPUT_DIR || './input',
  } = options;

  const pipeline = createPipelineController(phase1Api, { outputDir, logsDir });
  const ctx = {
    outputDir,
    staticDir,
    baseUrl,
    phase1Api,
    llmModelService,
    llmProcessService,
    logsDir,
    stagingDir,
    inputDir,
    pipeline,
  };

  return async (req, res) => {
    try {
      const url = new URL(req.url, baseUrl);
      return await routeRequest(ctx, req, res, url);
    } catch (error) {
      return sendError(res, error);
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
    inputDir = process.env.INPUT_DIR || './input',
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
    inputDir,
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
