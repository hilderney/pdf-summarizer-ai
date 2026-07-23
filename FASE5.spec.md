# FASE 5 — Especificação Técnica (SDD/TDD)
## PDF Summarizer AI — Autenticação JWT + TOTP e Controle de Acesso por Role

---

## 1. Visão Geral

A **Fase 5** adiciona autenticação e autorização ao sistema:

- **Página de login** exibida antes do shell de abas — nada da aplicação é acessível sem sessão.
- **Login com JWT**: usuário/senha → *access token* (JWT HS256, ~15 min) + *refresh token* (opaco, rotacionado). Enquanto o refresh for válido, o usuário permanece logado; refresh expirado/revogado → estado volta a **deslogado**.
- **Segunda etapa TOTP** (RFC 6238 — código de 6 dígitos que muda a cada 30 s, compatível com Google Authenticator/Authy): necessária para **processar e ler arquivos**. Um código válido concede um *elevation token* de **15 minutos**; expirado, a UI pede novo código **sem deslogar**.
- **Roles**: `ADM` (todas as abas e APIs) e `USER` (somente a aba **Arquivos** e as APIs de processamento/leitura de arquivos).
- Gate aplicado no **backend** (401/403 por rota) e refletido no **frontend** (abas ocultas por role) — a UI nunca é a única barreira.

**Dependências:** Fases 1–4 (appServer, persistence SQLite, cryptoAdapter AES-256-GCM, UI de abas). Nenhuma dependência npm nova — JWT, scrypt e TOTP usam apenas `crypto` nativo do Node.

---

## 2. Stack Tecnológica

| Camada | Lib / Ferramenta | Observação |
|--------|------------------|------------|
| Runtime | Node.js >= 20 LTS | Mesmo das fases anteriores |
| Hash de senha | `crypto.scrypt` (built-in) | Salt aleatório por usuário, `timingSafeEqual` |
| JWT | `crypto.createHmac` (built-in) | HS256, sem lib externa |
| TOTP | `crypto.createHmac('sha1')` (built-in) | RFC 6238, step 30 s, 6 dígitos, janela ±1 |
| Segredo TOTP | AES-256-GCM via `cryptoAdapter` (reuso) | Criptografado no SQLite com `APP_SECRET_KEY` |
| Persistência | SQLite (`better-sqlite3`, reuso) | Tabelas `users` e `refresh_tokens` no mesmo DB |
| UI | HTML5 + CSS + JS vanilla | Mesmo padrão das fases anteriores |
| Test Runner | Jest ^30 | Consistência com fases anteriores |

---

## 3. Estrutura de Pastas (delta)

```
pdf-summarizer-ai/
├── src/
│   ├── adapters/
│   │   ├── jwtAdapter.js                 # NOVO — sign/verify JWT HS256
│   │   ├── persistenceAdapter.js         # MODIFICADO — contrato users/refresh
│   │   ├── sqlitePersistenceAdapter.js   # MODIFICADO — tabelas + métodos users
│   │   └── memoryPersistenceAdapter.js   # MODIFICADO — espelho em memória
│   ├── modules/
│   │   ├── totpService.js                # NOVO — RFC 6238 puro (sem HTTP/DB)
│   │   ├── authService.js                # NOVO — login/refresh/elevate/seed
│   │   ├── authGuard.js                  # NOVO — política de rotas + guards HTTP
│   │   └── appServer.js                  # MODIFICADO — rotas /auth + enforcement
│   ├── errors/index.js                   # MODIFICADO — AuthError, TotpError
│   ├── pipeline/LlmSummarizerBuilder.js  # MODIFICADO — withAuth() no boot
│   └── server.js                         # MODIFICADO — envs de auth
├── public/
│   ├── index.html                        # MODIFICADO — login, modais TOTP, header user
│   ├── css/app.css                       # MODIFICADO — estilos login/modal
│   └── js/
│       ├── session-store.js              # NOVO — estado de sessão (tokens/role)
│       ├── auth-ui.js                    # NOVO — login, TOTP setup, elevação, logout
│       ├── api-client.js                 # MODIFICADO — fetchWithAuth + refresh automático
│       └── app.js                        # MODIFICADO — bootstrap gated por auth
├── tests/
│   ├── totpService.test.js               # NOVO
│   ├── jwtAdapter.test.js                # NOVO
│   ├── authService.test.js               # NOVO
│   └── authApi.test.js                   # NOVO — integração rotas + guards
└── .env.example                          # MODIFICADO — JWT_SECRET etc.
```

---

## 4. Modelo de Sessão

| Credencial | Formato | Duração | Concede |
|------------|---------|---------|---------|
| Access token | JWT HS256 `{ sub, username, role, kind: 'access' }` | `JWT_ACCESS_TTL_SECONDS` (default 900) | Acesso às rotas conforme role |
| Refresh token | Opaco (48 bytes hex); somente o SHA-256 é persistido | `JWT_REFRESH_TTL_SECONDS` (default 7 dias) | Renovar access token (rotação: o antigo é revogado) |
| Elevation token | JWT HS256 `{ sub, kind: 'elevation' }` | `ELEVATION_TTL_SECONDS` (default 900) | Processar/ler arquivos |

**Regras:**
1. Access expirado + refresh válido → novo par (login mantido, transparente na UI).
2. Refresh expirado, revogado ou desconhecido → 401 `REFRESH_INVALID` → UI limpa sessão e volta ao login.
3. Elevation expirado → 403 `ELEVATION_REQUIRED` → UI pede novo código TOTP (continua logado).
4. Elevation token só vale para o mesmo `sub` do access token que o acompanha.
5. Logout revoga o refresh token no servidor e limpa o client.

---

## 5. Política de Autorização por Rota

| Grupo | Rotas | Requisito |
|-------|-------|-----------|
| Público | `GET /`, `GET /css/*`, `GET /js/*`, `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh` | — |
| Sessão | `GET /api/v1/auth/me`, `POST /api/v1/auth/logout`, `POST /api/v1/auth/elevate`, `POST /api/v1/auth/totp/setup`, `POST /api/v1/auth/totp/confirm` | Access token |
| Arquivos (ADM+USER) | `/api/v1/files*`, `/open/*`, `/api/v1/fs/*`, `/api/v1/pipeline/*`, `/api/v1/input/*`, `/api/v1/spreadsheet/*` | Access + **Elevation** |
| Administração | `/api/v1/logs*`, `/api/v1/llm/models*`, `/api/v1/llm/jobs*`, `/api/v1/auth/users` | Access + role `ADM` |
| Administração + arquivos | `POST /api/v1/llm/process` | Access + role `ADM` + **Elevation** |

**Transporte dos tokens:**
- Access: header `Authorization: Bearer <jwt>`.
- Elevation: header `X-Elevation-Token: <jwt>`.
- Exceção `GET /open/:name` (links `<a href>` não enviam headers): aceita `?access_token=&elevation_token=` na query string.

**Compatibilidade de teste:** `createAppServer` recebe `authService` opcional; sem ele, o servidor opera aberto (modo usado pelos testes unitários das fases 1–4). O `LlmSummarizerBuilder` **sempre** cria e injeta o `authService` — o servidor de produção (`npm run start:web`) é sempre protegido.

---

## 6. Módulos Backend

### 6.1 `totpService.js` (puro — sem HTTP, sem DB)

```js
generateTotpSecret()                       // → base32 (20 bytes aleatórios)
buildOtpauthUri({ secret, username, issuer }) // → "otpauth://totp/..."
generateTotpCode(secret, { now, stepSeconds, digits })   // usado nos testes
verifyTotpCode(secret, code, { now, stepSeconds = 30, digits = 6, windowSteps = 1 })
```

- Janela ±1 step tolera clock skew entre servidor e authenticator.
- `now` injetável (`() => Date.now()`) para testes determinísticos.

### 6.2 `jwtAdapter.js`

```js
signJwt(payload, { secret, expiresInSeconds, now })  // → token HS256
verifyJwt(token, { secret, now })                    // → claims | AuthError
```

- Erros: `TOKEN_INVALID` (assinatura/formato) e `TOKEN_EXPIRED` — ambos `statusCode: 401`.

### 6.3 `authService.js`

Factory `createAuthService({ persistence, cryptoAdapter, jwtSecret, accessTtlSeconds, refreshTtlSeconds, elevationTtlSeconds, now })`:

```js
seedAdminIfEmpty({ username, password })  // cria ADM só se não existem usuários
createUser({ username, password, role })  // → UserDto (sem hash)
listUsers()
login({ username, password })     // → { accessToken, refreshToken, expiresInSeconds, user }
refresh({ refreshToken })         // → novo par (rotação)
logout({ refreshToken })          // revoga
setupTotp(userId)                 // → { secret, otpauthUri, qrCodeDataUrl } (pendente até confirm)
confirmTotp(userId, code)         // ativa totp_enabled
elevate(userId, code)             // → { elevationToken, expiresInSeconds }
verifyAccessToken(token)          // → claims
verifyElevationToken(token, expectedUserId)
```

- Senha: `scrypt` com salt aleatório de 16 bytes, formato `scrypt:<salt hex>:<hash hex>`, comparação com `timingSafeEqual`.
- Segredo TOTP criptografado com o `cryptoAdapter` existente (AES-256-GCM / `APP_SECRET_KEY`).
- Credencial inválida → `AuthError 401 INVALID_CREDENTIALS` (mesma mensagem para usuário inexistente e senha errada).
- `elevate` sem TOTP configurado → `AuthError 400 TOTP_NOT_CONFIGURED`.
- Código TOTP errado → `AuthError 401 INVALID_TOTP_CODE`.

### 6.4 `authGuard.js`

```js
resolveRoutePolicy(pathname, method)  // → { access: 'public'|'session'|..., roles, elevation }
createAuthGuard({ authService })      // → { authenticate(req, url), authorize(auth, policy, req, url) }
```

- `authenticate`: extrai Bearer (ou `access_token` na query para `/open/`), valida JWT → `{ userId, username, role }`; falha → `AuthError 401`.
- `authorize`: role fora da lista → `AuthError 403 FORBIDDEN_ROLE`; elevação ausente/expirada → `AuthError 403 ELEVATION_REQUIRED`.

### 6.5 Persistência (contrato adicionado aos dois adapters)

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADM', 'USER')),
  totp_secret_encrypted TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

Métodos: `createUser`, `getUserById`, `getUserByUsername`, `updateUser`, `listUsers`, `countUsers`, `insertRefreshToken`, `getRefreshToken`, `revokeRefreshToken`.

---

## 7. Rotas Novas

| Método | Path | Body | Resposta |
|--------|------|------|----------|
| POST | `/api/v1/auth/login` | `{ username, password }` | `200 { accessToken, refreshToken, expiresInSeconds, user: { id, username, role, totpEnabled } }` |
| POST | `/api/v1/auth/refresh` | `{ refreshToken }` | `200` novo par; `401 REFRESH_INVALID` |
| POST | `/api/v1/auth/logout` | `{ refreshToken }` | `200 { loggedOut: true }` |
| GET | `/api/v1/auth/me` | — | `200 { user, elevated, elevationExpiresAt }` |
| POST | `/api/v1/auth/totp/setup` | — | `200 { secret, otpauthUri, qrCodeDataUrl }` |
| POST | `/api/v1/auth/totp/confirm` | `{ code }` | `200 { totpEnabled: true }` |
| POST | `/api/v1/auth/elevate` | `{ code }` | `200 { elevationToken, expiresInSeconds }` |
| POST | `/api/v1/auth/users` | `{ username, password, role }` | `201 UserDto` (ADM) |
| GET | `/api/v1/auth/users` | — | `200 { users }` (ADM) |

---

## 8. Frontend

- **`session-store.js`**: único dono do estado de sessão (`accessToken`, `refreshToken`, `elevationToken`, `user`); persiste em `sessionStorage`; expõe `save/load/clear` e helpers `isElevationLikelyValid()`.
- **`auth-ui.js`**:
  - Tela de login (`#login-screen`) cobre a aplicação até haver sessão válida (`GET /api/v1/auth/me`).
  - Se `totpEnabled === false` após login: modal de setup exibe QR Code (`qrCodeDataUrl`) + segredo/URI em detalhes para entrada manual + campo de confirmação.
  - Modal de elevação: pede código de 6 dígitos; disparado pelo evento `auth:elevation-required` (emitido pelo `api-client` num 403 `ELEVATION_REQUIRED`).
  - Evento `auth:logged-out` (refresh falhou) → limpa sessão e mostra login.
  - Abas filtradas por role: `USER` vê apenas **Arquivos**; header mostra `username (role)` + botão **Sair**.
- **`api-client.js`**: wrapper único `request()` anexa `Authorization` e `X-Elevation-Token`; em 401 tenta `refresh` uma vez e repete; helper `withAuthQuery(url)` para links `/open/`.

---

## 9. Variáveis de Ambiente

```bash
# Obrigatória em produção — assinatura dos JWTs (32 bytes hex)
JWT_SECRET=

# Opcionais (defaults entre parênteses)
JWT_ACCESS_TTL_SECONDS=900        # (900 = 15 min)
JWT_REFRESH_TTL_SECONDS=604800    # (604800 = 7 dias)
ELEVATION_TTL_SECONDS=900         # (900 = 15 min)

# Seed do primeiro ADM (usado apenas se o banco não tem usuários)
BOOTSTRAP_ADMIN_USER=admin
BOOTSTRAP_ADMIN_PASSWORD=admin123   # trocar imediatamente
```

`JWT_SECRET` ausente → chave efêmera gerada com warning (mesmo comportamento do `APP_SECRET_KEY`); sessões não sobrevivem a reinícios.

---

## 10. Casos de Teste

```
SUITE: totpService
  ✦ [F5-01] generateTotpSecret retorna base32 válido com entropia suficiente
  ✦ [F5-02] generateTotpCode produz vetor conhecido da RFC 6238 (SHA-1)
  ✦ [F5-03] verifyTotpCode aceita código do step atual
  ✦ [F5-04] verifyTotpCode aceita código do step anterior/seguinte (janela ±1)
  ✦ [F5-05] verifyTotpCode rejeita código de 2 steps atrás
  ✦ [F5-06] verifyTotpCode rejeita código malformado (letras, tamanho errado)
  ✦ [F5-07] buildOtpauthUri contém issuer, username e secret

SUITE: jwtAdapter
  ✦ [F5-08] signJwt/verifyJwt roundtrip preserva claims
  ✦ [F5-09] verifyJwt rejeita assinatura adulterada (TOKEN_INVALID 401)
  ✦ [F5-10] verifyJwt rejeita token expirado (TOKEN_EXPIRED 401)

SUITE: authService — usuários e login
  ✦ [F5-11] seedAdminIfEmpty cria ADM apenas quando não há usuários
  ✦ [F5-12] createUser rejeita role inválida e username duplicado
  ✦ [F5-13] login com credenciais corretas retorna par de tokens + user sem hash
  ✦ [F5-14] login com senha errada ou usuário inexistente → 401 INVALID_CREDENTIALS
  ✦ [F5-15] refresh rotaciona: novo par válido e refresh antigo revogado
  ✦ [F5-16] refresh com token expirado/desconhecido → 401 REFRESH_INVALID
  ✦ [F5-17] logout revoga o refresh token

SUITE: authService — TOTP e elevação
  ✦ [F5-18] setupTotp + confirmTotp ativam TOTP (segredo criptografado + QR data URL)
  ✦ [F5-19] elevate com código válido retorna elevationToken de 15 min
  ✦ [F5-20] elevate com código inválido → 401 INVALID_TOTP_CODE
  ✦ [F5-21] elevate sem TOTP configurado → 400 TOTP_NOT_CONFIGURED
  ✦ [F5-22] verifyElevationToken rejeita token de outro usuário e token expirado

SUITE: API REST — integração appServer + guards
  ✦ [F5-23] POST /api/v1/auth/login → 200 com tokens; senha errada → 401
  ✦ [F5-24] rota protegida sem Authorization → 401
  ✦ [F5-25] rota protegida com access válido mas sem elevação → 403 ELEVATION_REQUIRED
  ✦ [F5-26] fluxo completo: login → elevate → POST /api/v1/input/stage → 201
  ✦ [F5-27] USER em rota ADM (GET /api/v1/logs) → 403 FORBIDDEN_ROLE
  ✦ [F5-28] USER em rota de arquivos com elevação → 200
  ✦ [F5-29] POST /api/v1/auth/refresh renova sessão; refresh revogado → 401
  ✦ [F5-30] GET /open/:name aceita tokens via query string
  ✦ [F5-31] rotas públicas (/, /css, /js, login) seguem acessíveis sem token
  ✦ [F5-32] POST /api/v1/auth/users por USER → 403; por ADM → 201
```

---

## 11. Fluxo End-to-End

```
Usuário
    │
    ├─► Abre a UI → tela de login (app oculto)
    │
    ├─► POST /auth/login (user+senha)
    │       └─► accessToken (15 min) + refreshToken + role
    │
    ├─► totpEnabled=false? → modal setup: cadastra secret no authenticator → confirm
    │
    ├─► Clica "Processar selecionados"
    │       └─► 403 ELEVATION_REQUIRED → modal pede código de 30 s
    │               └─► POST /auth/elevate → elevationToken (15 min)
    │                       └─► retry automático da ação → 201
    │
    ├─► Access expira → api-client faz POST /auth/refresh transparente → segue logado
    │
    ├─► Elevação expira (15 min) → novo 403 → modal TOTP de novo (segue logado)
    │
    └─► Refresh expira/revogado → 401 → sessão limpa → tela de login
```

---

## 12. Critérios de Aceite (Definition of Done — FASE 5)

- [ ] Casos F5-01..F5-32 passam (`npm test`) e as suítes das fases 1–4 continuam verdes
- [ ] UI inicia na tela de login; nenhuma aba visível sem sessão
- [ ] USER vê somente a aba Arquivos; ADM vê todas
- [ ] Processar/ler arquivos exige código TOTP; elevação dura 15 min
- [ ] Refresh mantém login transparente; refresh expirado desloga
- [ ] Nenhuma senha ou segredo TOTP em claro no banco ou em logs
- [ ] Nenhuma dependência npm nova
- [ ] `npm audit` sem vulnerabilidades high/critical

---

## 13. Ordem de Implementação (TDD)

```
Passo 1 → AuthError/TotpError em errors/index.js
Passo 2 → totpService                  (F5-01..07)
Passo 3 → jwtAdapter                   (F5-08..10)
Passo 4 → persistence users/refresh    (schema + adapters)
Passo 5 → authService                  (F5-11..22)
Passo 6 → authGuard + rotas appServer  (F5-23..32)
Passo 7 → LlmSummarizerBuilder.withAuth + server.js + .env.example
Passo 8 → frontend: session-store, auth-ui, api-client, index.html, app.js, css
```

---

## 14. Segurança

1. **Senhas**: scrypt + salt por usuário; `timingSafeEqual`; mensagens de erro não distinguem usuário inexistente de senha errada.
2. **Refresh tokens**: nunca armazenados em claro (SHA-256); rotação a cada uso; revogação em logout.
3. **Segredo TOTP**: AES-256-GCM no banco (mesma chave-mestra dos tokens LLM); exposto uma única vez no setup.
4. **JWTs**: HS256 com `JWT_SECRET`; `kind` diferencia access de elevation (um não substitui o outro).
5. **Elevação por escopo**: token de elevação amarrado ao `sub`; não reutilizável entre usuários.
6. **Backend como fonte de verdade**: toda rota sensível revalida role e elevação — esconder abas é só UX.
7. **Sem novos vetores**: nenhuma dependência externa; tudo `crypto` nativo.
