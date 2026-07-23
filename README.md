# PDF Summarizer AI

Pipeline modular em Node.js para extrair texto de PDFs, estruturar dados tabulares, exportar planilhas e processar conteúdo com LLMs — com interface web, gestão de logs e autenticação JWT + TOTP.

| Fase | Entrega |
|------|---------|
| **1** | Base reutilizável (scan → extração → CSV/Excel → links → logs) |
| **2** | UI web + API REST + CRUD LLM (Ollama/OpenRouter) |
| **3** | Entrada unificada de arquivos (PDF + planilhas) na aba Arquivos |
| **4** | Aba de gerenciamento de logs (listar, filtrar, abrir, excluir) |
| **5** | Login JWT + 2FA TOTP, roles ADM/USER e elevação para processar/ler arquivos |
| **6** | Multi-tenant (models/jobs por usuário), assinatura mensal, MySQL |

Especificações: [`FASE1.spec.md`](FASE1.spec.md) · [`FASE2.spec.md`](FASE2.spec.md) · [`FASE4.spec.md`](FASE4.spec.md) · [`FASE5.spec.md`](FASE5.spec.md) · [`FASE6.spec.md`](FASE6.spec.md)

---

## Roadmap

| Fase | Escopo | Status |
|------|--------|--------|
| **1** | Scan → extração → exportação (CSV/Excel) → links locais → logs | Implementada |
| **2** | UI web + API REST + CRUD LLM (Ollama/OpenRouter) + resposta JSON | Implementada |
| **3** | Aba Arquivos unificada (PDF + XLS/XLSX), pipeline de entrada | Implementada |
| **4** | Aba Logs — listar, filtrar, visualizar e excluir `.log` | Implementada |
| **5** | Autenticação JWT + refresh, TOTP (30 s), RBAC ADM/USER | Implementada |
| **6** | Multi-tenant + assinatura mensal + adapter MySQL | Implementada |
| **7** | Instalador standalone Windows (`.exe`) | Planejada |

---

## Fase 1 — O que faz

1. **Lista PDFs** em um diretório local (com opção recursiva).
2. **Extrai texto** em batch, gerando um `.txt` por PDF (mesmo nome base sanitizado).
3. **Exporta planilhas** por PDF:
   - `.csv` — dados tabulares filtrados
   - `.xlsx` — Excel com as mesmas colunas
4. **Filtra só linhas de tabela** do documento (ignora cabeçalhos, rodapés, totais e metadados).
5. **Serve links locais** (`http://localhost:4000/files`) para abrir arquivos gerados.
6. **Registra logs** estruturados (NDJSON) por sessão em `logs/`.

---

## Requisitos

- Node.js **>= 20** LTS
- npm

```bash
npm install
```

---

## Uso rápido (CLI)

```bash
npm start -- <pasta-com-pdfs> [pasta-saida]
```

Exemplo:

```bash
npm start -- ./fixtures ./output
```

Saída típica por PDF `Produção unimed pgto070726.PDF`:

```
output/
  Produ__o_unimed_pgto070726.txt    # texto completo extraído
  Produ__o_unimed_pgto070726.csv    # só linhas de tabela
  Produ__o_unimed_pgto070726.xlsx   # só linhas de tabela
logs/
  session_<timestamp>_<id>.log
```

Links: `http://localhost:4000/files`

---

## Fase 2 — Interface web + LLM

### Iniciar servidor web

```bash
npm run start:web
```

Abre a UI em `http://127.0.0.1:4000`. Com a Fase 5 ativa, a tela inicia no **login**; após autenticar, as abas disponíveis dependem da role:

| Aba | Conteúdo | Quem vê |
|-----|----------|---------|
| **Arquivos** | Upload/processamento de PDF e planilhas + arquivos gerados | ADM e USER |
| **Logs** | Listar, filtrar, abrir e excluir logs de sessão | Só ADM |
| **LLM Config** | CRUD de modelos Ollama e OpenRouter (token criptografado) — **por usuário** | ADM e USER |
| **LLM** | Envia `.txt`/`.csv`/`.xlsx` para a LLM; resumo + link JSON — **por usuário** | ADM e USER |

### API REST (`/api/v1`)

| Grupo | Rotas | Auth (Fase 5) |
|-------|-------|---------------|
| Auth | `POST /auth/login`, `/refresh`, `/logout`, `/elevate`, `/totp/*`, `GET /auth/me`, `/auth/users` | público / sessão / ADM |
| Pipeline | `POST /pipeline/scan`, `/extract`, `/export`, `/run`, `/stage` | sessão + elevação |
| Entrada | `POST /input/stage`, `/process`, `/run` | sessão + elevação |
| Arquivos | `GET /files`, `DELETE /files/:name`, `GET /open/:filename` | sessão + elevação |
| Logs | `GET /logs`, `GET/DELETE /logs/:name`, `POST /logs/batch-delete` | sessão + ADM |
| LLM CRUD | `GET/POST/PUT/DELETE /llm/models`, `POST .../health` | sessão + ADM |
| Processamento | `POST /llm/process`, `GET /llm/jobs` | ADM (+ elevação no process) |

### Facade Fase 2

```javascript
const {
  LlmSummarizerBuilder,
  createLlmAdapter,
  createPersistenceAdapter,
  ...phase1Exports
} = require('./src/api-v2');

const app = LlmSummarizerBuilder.create()
  .fromPhase1Api(require('./src/api'))
  .withPersistence('sqlite', { dbPath: './data/app.db' })
  .serve({ port: 4000 })
  .build();

await app.start();
// app.url → http://127.0.0.1:4000
```

### Variáveis de ambiente

O arquivo `.env` na raiz do projeto é carregado automaticamente ao iniciar `npm run start:web`. Copie `.env.example` para `.env` e preencha os valores.

| Variável | Default | Descrição |
|----------|---------|-----------|
| `APP_SECRET_KEY` | gerada em dev (efêmera) | Chave AES-256 para tokens OpenRouter e segredos TOTP. **Defina uma chave fixa** (hex 64 chars) para sobreviverem a reinícios |
| `JWT_SECRET` | gerada em dev (efêmera) | Assinatura dos JWTs de sessão/elevação. **Defina uma chave fixa** em produção |
| `BOOTSTRAP_ADMIN_USER` | `admin` | Usuário ADM criado no primeiro boot (só se o banco não tiver usuários) |
| `BOOTSTRAP_ADMIN_PASSWORD` | `admin123` | Senha do ADM seed — **troque imediatamente** |
| `JWT_ACCESS_TTL_SECONDS` | `900` | Validade do access token / countdown na UI (15 min) |
| `JWT_REFRESH_TTL_SECONDS` | `604800` | Validade do refresh token (7 dias) |
| `ELEVATION_TTL_SECONDS` | `900` | Validade da elevação TOTP (15 min) |
| `OPENROUTER_API_KEY` | — | Opcional; token global (não substitui token por modelo na UI) |
| `DB_PATH` | `./data/app.db` | SQLite (quando `PERSISTENCE=sqlite`) |
| `PERSISTENCE` | `sqlite` | `sqlite` ou `mysql` |
| `MYSQL_HOST` / `PORT` / `USER` / `PASSWORD` / `DATABASE` | — | Credenciais MySQL (Hostinger) |
| `PORT` | `4000` | Porta HTTP |
| `HOST` | `127.0.0.1` | Bind HTTP (localhost por padrão) |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama local |

Gerar chaves:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Fase 4 — Aba de Logs

Especificação: [`FASE4.spec.md`](FASE4.spec.md)

A aba **Logs** (somente ADM) permite gerenciar os arquivos NDJSON gerados pelo logger:

- Listagem de `.log` em `logs/` com tamanho e data de modificação
- Filtro por nome (case-insensitive) e ordenação por nome ou data
- Checkbox por arquivo + “Selecionar todos” (apenas linhas visíveis)
- **Abrir** — carrega o conteúdo na área de visualização (read-only)
- **Excluir selecionados** — exclusão em lote com confirmação

### API de logs

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/v1/logs` | Lista logs (`?search=&sort=date\|name&order=asc\|desc`) |
| `GET` | `/api/v1/logs/:filename` | Conteúdo textual do log |
| `DELETE` | `/api/v1/logs/:filename` | Remove um arquivo |
| `POST` | `/api/v1/logs/batch-delete` | Body `{ files: ["a.log", ...] }` |

Path traversal e extensões diferentes de `.log` são rejeitados (`isPathInside` + validação de nome).

---

## Fase 5 — Autenticação e autorização

Especificação: [`FASE5.spec.md`](FASE5.spec.md)

### Modelo de sessão

| Credencial | Duração | Concede |
|------------|---------|---------|
| **Access JWT** (user/senha) | ~15 min | Sessão + abas conforme role |
| **Refresh token** (opaco, rotacionado) | ~7 dias | Renova o access sem novo login; expirado → **deslogado** |
| **Elevation token** (código TOTP de 6 dígitos / 30 s) | 15 min | Processar e ler arquivos; expirado → pede TOTP de novo (continua logado) |

Fluxo típico:

```
Login (user+senha) → abas por role
        │
        ├─► 1º acesso sem TOTP → modal de setup (secret / otpauth URI) → Authenticator
        │
        └─► Processar/ler arquivo → pede código TOTP → elevação 15 min
                │
                ├─► Access expira → refresh automático (continua logado)
                └─► Refresh expira/revogado → volta à tela de login
```

### Roles

| Role | Abas | APIs |
|------|------|------|
| `ADM` | Todas | Todas (elevação exigida nas de arquivo) |
| `USER` | Só **Arquivos** | Só input/pipeline/files/open (+ auth); 403 no resto |

O gate é aplicado no **backend** (401/403) e refletido na UI (abas ocultas). A UI nunca é a única barreira.

### Primeiro acesso

1. Defina `JWT_SECRET`, `APP_SECRET_KEY` e `BOOTSTRAP_ADMIN_PASSWORD` no `.env`
2. `npm run start:web`
3. Entre com o usuário ADM seed e cadastre o TOTP no Google Authenticator / Authy
4. (Opcional) Crie usuários `USER` via `POST /api/v1/auth/users` (só ADM)

Tokens OpenRouter e o segredo TOTP ficam criptografados no SQLite (AES-256-GCM). Senhas usam `scrypt`; JWT e TOTP usam apenas `crypto` nativo do Node — nenhuma dependência npm nova.

---

## Fase 6 — Multi-tenant, assinatura e MySQL

Especificação: [`FASE6.spec.md`](FASE6.spec.md)

- Cada usuário tem **seus próprios** models e jobs (`user_id`).
- **Arquivos isolados no disco:** `output/<userId>/` e `staging/<userId>/` (listagem, download, stage e processamentos).
- Assinatura mensal **manual**: campos `subscription_status`, `subscription_expires_at`, `subscription_plan`. Sem Stripe/PIX.
- **ADM** isento de expiração; **USER** bloqueado (`403 SUBSCRIPTION_EXPIRED`) se a assinatura não estiver ativa.
- Renovação via API ADM: `PATCH /api/v1/auth/users/:id/subscription` com `{ months: 1 }` ou `{ expiresAt, plan, status }`.
- Persistência: `PERSISTENCE=sqlite` (dev) ou `PERSISTENCE=mysql` (produção Hostinger).

```bash
# .env produção Hostinger (exemplo)
PERSISTENCE=mysql
MYSQL_HOST=...
MYSQL_USER=...
MYSQL_PASSWORD=...
MYSQL_DATABASE=pdf_summarizer
```

---

## Arquitetura modular

A Fase 1 foi pensada para ser **composta**, não monolítica. Cada camada tem responsabilidade única e pode ser chamada isoladamente pelas fases seguintes.

```
pdf-summarizer-ai/
├── src/
│   ├── api.js                 # Facade Fase 1
│   ├── api-v2.js              # Facade Fase 2 (re-exporta Fase 1 + LLM)
│   ├── server.js              # Entry point web (npm run start:web)
│   ├── index.js               # CLI
│   ├── adapters/              # PDF, Excel, crypto, JWT, persistence…
│   ├── modules/               # Regras de negócio (incl. auth, logs, input)
│   ├── pipeline/              # Orquestração fluente (Builder)
│   ├── errors/                # Erros tipados
│   └── utils/                 # Utilitários compartilhados
├── public/                    # UI (login, abas, api-client)
└── tests/                     # TDD / SDD por fase
```

### Camadas

| Camada | Papel | Consumida por |
|--------|-------|----------------|
| **modules** | Lógica de domínio (scan, extract, export, log, auth, logs UI) | Pipeline, API, UI |
| **adapters** | Implementação concreta de libs / crypto / JWT / DB | Modules (injeção/factory) |
| **pipeline** | Orquestra o fluxo completo com Builder | CLI, `start:web` |
| **api.js** | Facade estável para import externo | Integrações e testes |

### Fluxo de dados

```
PDFs ──► scanner ──► extractor ──► .txt
                         │
                         ▼
                  tableParser ──► linhas de tabela
                         │
                         ▼
                    exporter ──► .csv / .xlsx
                         │
            linker ◄─────┴────► links HTTP locais
            logger  (em todas as etapas)
```

---

## API programática (Fase 2 / Fase 3)

Importe o pacote pela facade pública — **não acople diretamente ao CLI** (`src/index.js`).

```javascript
const {
  PdfSummarizerBuilder,
  listPdfs,
  extractText,
  extractBatch,
  exportCsv,
  exportXlsx,
  createServer,
  createLogger,
  adapters,
  errors,
} = require('./src/api');
```

### Opção A — Pipeline completo (Builder)

Ideal para a Fase 3 (app/desktop) e fluxos “um clique” da Fase 2.

```javascript
const pipeline = PdfSummarizerBuilder.create()
  .fromDirectory('./pdfs')
  .outputTo('./output')
  .withLogs('./logs')
  .recursive(false)
  .overwrite(true)
  .exportFormats(['csv', 'xlsx'])   // 'xls' e 'excel' também aceitos
  .serveLinks(4000)                 // ou .withoutServer()
  .build();

const summary = await pipeline.run();
// summary: { scanned, extracted, failed, exports, logFile, serverUrl, files }

await pipeline.close(); // encerra servidor e logger
```

**Retorno `summary.exports`:**

```javascript
{
  csv:  [{ filePath, rowCount, sourcePdf }, ...],
  xlsx: [{ filePath, rowCount, sourcePdf }, ...],
}
```

Um arquivo de exportação **por PDF**, com nome derivado do PDF de origem.

### Opção B — Módulos isolados

Ideal para a Fase 2 montar fluxos customizados (ex.: extrair → escolher arquivo → enviar à LLM).

#### 1. Listar PDFs

```javascript
const pdfs = await listPdfs('./pdfs', { recursive: false });
// [{ name, path, sizeBytes }, ...]
```

#### 2. Extrair texto

```javascript
const result = await extractText('./pdfs/doc.pdf', './output', { overwrite: true });
// { inputFile, outputFile, pageCount, charCount, text, extractedAt }
```

```javascript
const batch = await extractBatch(['a.pdf', 'b.pdf'], './output');
// { results: [...], errors: [...] }
```

#### 3. Exportar planilhas (com filtro de tabela)

```javascript
const csv = await exportCsv([result], './output');
// { filePath: '.../doc.csv', rowCount, sourcePdf }

const xlsx = await exportXlsx([result], './output', {
  tableOnly: true,       // padrão: true
  fallbackToRaw: true,   // se não houver tabela, exporta texto bruto
  format: 'legacy',      // use 'unimed-report' (padrão) para layout Unimed
});
```

#### 4. Servidor de links

```javascript
const server = await createServer({ port: 4000, outputDir: './output' });
// server.url → 'http://127.0.0.1:4000'
// GET /files  → lista arquivos
// GET /open/:filename → serve arquivo

await server.close();
```

#### 5. Logger

```javascript
const log = createLogger('meu-modulo', { logsDir: './logs' });
log.info('Processando', { count: 3 });
log.error('Falha', new Error('detalhe'));
await log.close();
```

---

## Módulos

### `scanner`

| Função | Descrição |
|--------|-----------|
| `listPdfs(dir, { recursive })` | Lista PDFs com caminho absoluto e tamanho |

Erro: `ScannerError`

### `extractor`

| Função | Descrição |
|--------|-----------|
| `extractText(pdfPath, outputDir, options)` | Extrai um PDF → `.txt` |
| `extractBatch(paths, outputDir, options)` | Batch tolerante a falhas |

Opções: `overwrite`, `parserAdapter`

Erro: `ExtractionError`

### `exporter`

| Função | Descrição |
|--------|-----------|
| `exportCsv(results, outputDir, options)` | CSV por PDF |
| `exportXlsx(results, outputDir, options)` | Excel por PDF |
| `resolveExportRows(results, options)` | Resolve linhas (tabela ou raw) sem gravar arquivo |

**Layout padrão (`format: 'unimed-report'`)** — planilha formatada para relatórios Unimed:

| Linha | Conteúdo |
|-------|----------|
| 1 | Nome do prestador (extraído do PDF) |
| 2 | `UNIMED - 1º PGTO PROGRAMADO PARA {data}` + intervalo de produção |
| 3 | Cabeçalho com 12 colunas |
| 4+ | Dados ordenados por Executante → Beneficiário |
| após cada Executante | `TOTAL - {NOME}` com somatório de Qt |
| final | `TOTAL GERAL` |
| após a tabela | **RESUMO GERAL** — blocos por Executante com `VR.SESSÕES`, `QUANT.` e `TOTAL` por valor de sessão, subtotal do Executante e `TOTAL GERAL` consolidado |

Colunas: `Requisição`, `Protocolo`, `Guia`, `Beneficiário`, `Atendimento`, `Executante`, `Serviço`, `Qt`, `Item`, `Vl Bruto`, `Vl Glosa`, `Vl Pago`.

A data de pagamento é calculada como **dia 5 do mês seguinte** ao fim da `Dt pesquisa` do PDF. Valores monetários (`Item`, `Vl Bruto`, `Vl Glosa`, `Vl Pago`) usam placeholders nesta fase (`-` / `0,00 R$`).

Use `format: 'legacy'` para o formato flat anterior (`source_pdf`, `guia`, `medico`, etc.).

Erro: `ExportError`

### `linker`

| Função | Descrição |
|--------|-----------|
| `createServer({ port, outputDir, host })` | HTTP local para links |

Erro: `LinkerError`

### `logger`

| Função | Descrição |
|--------|-----------|
| `createLogger(moduleName, options)` | Logger NDJSON por sessão |

---

## Adapters (extensibilidade)

Bibliotecas externas ficam atrás de adapters. Para trocar implementação, use as factories em `src/adapters/`:

| Adapter | Padrão | Factory | Alternativas |
|---------|--------|---------|--------------|
| PDF | `pdf-parse` v2 | `createPdfParserAdapter('pdf-parse-v2')` | `pdf-parse-v1` |
| Excel | `exceljs` | `createExcelWriterAdapter('exceljs')` | extensível |
| CSV | `csv-writer` | `createCsvWriterAdapter('csv-writer')` | extensível |
| Log | `pino` | `createLoggerAdapter('pino')` | extensível |
| Tabela | heurística Unimed | `createTableParserAdapter('auto')` | `unimed-guia`, `generic` |

### Exemplo — injetar adapter no extrator

```javascript
const { createPdfParserAdapter } = require('./src/adapters/pdfParserAdapter');

const result = await extractText('./doc.pdf', './output', {
  parserAdapter: createPdfParserAdapter('pdf-parse-v2'),
  overwrite: true,
});
```

### Exemplo — novo formato de tabela (Fase 2+)

Crie um parser em `tableParserAdapter.js` e registre na factory `createTableParserAdapter`. A Fase 2 pode selecionar o parser conforme o tipo de documento escolhido pelo usuário.

```javascript
const { createTableParserAdapter } = require('./src/adapters/tableParserAdapter');

const parsed = createTableParserAdapter('unimed-guia').parse(textoExtraido);
// { rows: [...], skippedLines: [...], parser: 'unimed-guia' }
```

---

## Integração Fase 2 (LLM) — implementada

Ver [`FASE2.spec.md`](FASE2.spec.md) e a seção "Fase 2" acima.

A Fase 1 expõe os artefatos que a UI/LLM consomem:

| Artefato | Uso |
|----------|-----|
| `.txt` | Texto completo para prompt da LLM |
| `.csv` / `.xlsx` | Dados tabulares filtrados para análise/resumo |
| `summary.files` | Lista de extrações com metadados |
| `createServer` / `/open/:name` | Links para abrir arquivos e respostas JSON |
| `createLogger` | Rastreio NDJSON (consumido pela aba Logs — Fase 4) |

```
Fase 1 (extract + export) → usuário escolhe .txt/.csv/.xlsx → LLM adapter → .json + resumo
```

---

## Integração prevista — instalador (futuro)

Empacotar o mesmo núcleo em um instalador Windows:

- **Entry point desktop:** `LlmSummarizerBuilder` + UI já autenticada
- **CLI embutida:** `src/index.js` ou wrapper
- **Diretórios padrão:** `output/`, `logs/`, `data/` (gitignored)
- **Dependência Node:** `>= 20` empacotado no instalador

O instalador não precisa reimplementar scan/extract/export/auth — apenas orquestra a API existente.

---

## Testes

```bash
npm test              # suite completa (Fases 1–5)
npm run test:coverage # cobertura
```

Estrutura espelha os módulos: `tests/scanner.test.js`, `tests/authService.test.js`, `tests/logViewerService.test.js`, `tests/authApi.test.js`, etc.

---

## Scripts

| Script | Descrição |
|--------|-----------|
| `npm start` | CLI Fase 1 — pipeline completo |
| `npm run start:web` | Servidor web (UI + API + auth) |
| `npm test` | Suite de testes |
| `npm run test:coverage` | Cobertura |
| `node scripts/create-fixtures.js` | Gera PDFs de exemplo em `fixtures/` |

---

## Segurança

**Fase 1–4 (base):**
- Sem `eval` nem execução de código embarcado em PDF
- Path traversal bloqueado (`linker`, logs, static, open)
- Saídas isoladas em `output/` e `logs/`
- Nomes de arquivo sanitizados (`sanitizeBaseName`)
- Bind padrão em `127.0.0.1`

**Fase 5 (auth):**
- Senhas com `scrypt` + salt por usuário (`timingSafeEqual`)
- Refresh tokens armazenados apenas como SHA-256; rotação a cada uso
- Segredo TOTP e tokens OpenRouter criptografados (AES-256-GCM / `APP_SECRET_KEY`)
- JWT HS256 com `kind` distinto para access vs elevation
- Elevação amarrada ao `sub` do usuário; role e elevação revalidadas em toda rota sensível
- Nenhuma dependência npm nova para JWT/TOTP — só `crypto` nativo

---

## Referências

- Especificação TDD Fase 1: [`FASE1.spec.md`](FASE1.spec.md)
- Especificação SDD Fase 2: [`FASE2.spec.md`](FASE2.spec.md)
- Especificação SDD Fase 4 (Logs): [`FASE4.spec.md`](FASE4.spec.md)
- Especificação SDD/TDD Fase 5 (Auth): [`FASE5.spec.md`](FASE5.spec.md)
- Especificação SDD/TDD Fase 6 (Multi-tenant): [`FASE6.spec.md`](FASE6.spec.md)
- Visão original das fases: [`README_OLD.md`](README_OLD.md)