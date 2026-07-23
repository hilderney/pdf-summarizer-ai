const crypto = require('crypto');
const QRCode = require('qrcode');
const { AuthError } = require('../errors');
const { signJwt, verifyJwt } = require('../adapters/jwtAdapter');
const { toUserDto } = require('../adapters/persistenceMappers');
const {
  generateTotpSecret,
  buildOtpauthUri,
  verifyTotpCode,
} = require('./totpService');

const ACCESS_TTL_SECONDS_DEFAULT = 15 * 60;
const REFRESH_TTL_SECONDS_DEFAULT = 7 * 24 * 60 * 60;
const ELEVATION_TTL_SECONDS_DEFAULT = 15 * 60;
const REFRESH_TOKEN_BYTES = 48;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_KEY_LENGTH = 64;
const VALID_ROLES = ['ADM', 'USER'];
const TOTP_ISSUER = 'PDF Summarizer AI';

function hashPassword(password) {
  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [scheme, salt, expectedHex] = String(storedHash).split(':');
  if (scheme !== 'scrypt' || !salt || !expectedHex) {
    return false;
  }

  const actual = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function hashRefreshToken(refreshToken) {
  return crypto.createHash('sha256').update(refreshToken).digest('hex');
}

function invalidCredentials() {
  // Mesma mensagem para usuário inexistente e senha errada — não vaza quais contas existem.
  return new AuthError('Invalid username or password', { code: 'INVALID_CREDENTIALS' });
}

function isSubscriptionActive(user, nowMs = Date.now()) {
  if (!user) {
    return false;
  }
  const role = user.role;
  if (role === 'ADM') {
    return true;
  }

  const status = user.subscription_status ?? user.subscriptionStatus ?? 'none';
  const expiresAt = user.subscription_expires_at ?? user.subscriptionExpiresAt ?? null;
  if (status !== 'active' || !expiresAt) {
    return false;
  }
  return new Date(expiresAt).getTime() > nowMs;
}

function subscriptionInfo(user, nowMs = Date.now()) {
  const dto = toUserDto(user) || user;
  return {
    status: dto.subscriptionStatus ?? 'none',
    expiresAt: dto.subscriptionExpiresAt ?? null,
    plan: dto.subscriptionPlan ?? null,
    active: isSubscriptionActive(user, nowMs),
  };
}

function createAuthService(options = {}) {
  const {
    persistence,
    cryptoAdapter,
    jwtSecret,
    accessTtlSeconds = ACCESS_TTL_SECONDS_DEFAULT,
    refreshTtlSeconds = REFRESH_TTL_SECONDS_DEFAULT,
    elevationTtlSeconds = ELEVATION_TTL_SECONDS_DEFAULT,
    now = () => Date.now(),
  } = options;

  if (!persistence || !cryptoAdapter || !jwtSecret) {
    throw new AuthError('persistence, cryptoAdapter and jwtSecret are required', {
      statusCode: 500,
      code: 'MISCONFIGURED',
    });
  }

  function issueAccessToken(user) {
    return signJwt(
      { sub: user.id, username: user.username, role: user.role, kind: 'access' },
      { secret: jwtSecret, expiresInSeconds: accessTtlSeconds, now },
    );
  }

  async function issueRefreshToken(userId) {
    const refreshToken = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const expiresAt = new Date(now() + refreshTtlSeconds * 1000).toISOString();
    await persistence.insertRefreshToken({
      tokenHash: hashRefreshToken(refreshToken),
      userId,
      expiresAt,
    });
    return refreshToken;
  }

  async function buildTokenPair(user) {
    return {
      accessToken: issueAccessToken(user),
      refreshToken: await issueRefreshToken(user.id),
      expiresInSeconds: accessTtlSeconds,
      user: toUserDto(user),
    };
  }

  async function requireUserById(userId) {
    const user = await persistence.getUserById(userId);
    if (!user) {
      throw new AuthError('User not found', { statusCode: 404, code: 'USER_NOT_FOUND' });
    }
    return user;
  }

  return {
    async seedAdminIfEmpty({ username, password }) {
      const total = await persistence.countUsers();
      if (total > 0) {
        return null;
      }
      return this.createUser({ username, password, role: 'ADM' });
    },

    async createUser({
      username,
      password,
      role,
      subscriptionExpiresAt,
      subscriptionPlan,
      subscriptionStatus,
    }) {
      if (!username || !password) {
        throw new AuthError('username and password are required', {
          statusCode: 400,
          code: 'INVALID_USER_DATA',
        });
      }
      if (!VALID_ROLES.includes(role)) {
        throw new AuthError(`role must be one of: ${VALID_ROLES.join(', ')}`, {
          statusCode: 400,
          code: 'INVALID_ROLE',
        });
      }
      if (await persistence.getUserByUsername(username)) {
        throw new AuthError('Username already exists', {
          statusCode: 409,
          code: 'USERNAME_TAKEN',
        });
      }

      let status = subscriptionStatus;
      let expiresAt = subscriptionExpiresAt !== undefined ? subscriptionExpiresAt : null;
      if (!status) {
        if (role === 'ADM') {
          status = 'active';
          expiresAt = null;
        } else if (expiresAt && new Date(expiresAt).getTime() > now()) {
          status = 'active';
        } else {
          status = 'none';
        }
      }

      const user = await persistence.createUser({
        username,
        passwordHash: hashPassword(password),
        role,
        subscriptionStatus: status,
        subscriptionExpiresAt: expiresAt,
        subscriptionPlan: subscriptionPlan ?? (role === 'USER' ? 'monthly' : null),
      });
      return toUserDto(user);
    },

    isSubscriptionActive(user) {
      return isSubscriptionActive(user, now());
    },

    getSubscriptionInfo(user) {
      return subscriptionInfo(user, now());
    },

    async updateSubscription(userId, { expiresAt, plan, status } = {}) {
      const user = await requireUserById(userId);
      const nextExpires =
        expiresAt !== undefined ? expiresAt : user.subscription_expires_at;
      let nextStatus = status;
      if (!nextStatus) {
        if (user.role === 'ADM') {
          nextStatus = 'active';
        } else if (nextExpires && new Date(nextExpires).getTime() > now()) {
          nextStatus = 'active';
        } else if (nextExpires) {
          nextStatus = 'expired';
        } else {
          nextStatus = 'none';
        }
      }

      const updated = await persistence.updateUser(userId, {
        subscriptionExpiresAt: nextExpires,
        subscriptionPlan: plan !== undefined ? plan : user.subscription_plan,
        subscriptionStatus: nextStatus,
      });
      return toUserDto(updated);
    },

    async renewSubscription(userId, { months = 1, plan = 'monthly' } = {}) {
      const user = await requireUserById(userId);
      const baseMs = Math.max(
        now(),
        user.subscription_expires_at
          ? new Date(user.subscription_expires_at).getTime()
          : now(),
      );
      const expiresAt = new Date(baseMs);
      expiresAt.setUTCMonth(expiresAt.getUTCMonth() + months);
      return this.updateSubscription(userId, {
        expiresAt: expiresAt.toISOString(),
        plan,
        status: 'active',
      });
    },

    requireActiveSubscription(user) {
      if (!isSubscriptionActive(user, now())) {
        throw new AuthError('Subscription expired or inactive', {
          statusCode: 403,
          code: 'SUBSCRIPTION_EXPIRED',
        });
      }
    },

    async listUsers() {
      const users = await persistence.listUsers();
      return users.map(toUserDto);
    },

    async getUser(userId) {
      return toUserDto(await persistence.getUserById(userId));
    },

    async login({ username, password }) {
      const user = username ? await persistence.getUserByUsername(username) : null;
      if (!user || !verifyPassword(password ?? '', user.password_hash)) {
        throw invalidCredentials();
      }
      return buildTokenPair(user);
    },

    async refresh({ refreshToken }) {
      const stored = refreshToken
        ? await persistence.getRefreshToken(hashRefreshToken(refreshToken))
        : null;

      const isUsable =
        stored && !stored.revoked_at && new Date(stored.expires_at).getTime() > now();
      if (!isUsable) {
        throw new AuthError('Refresh token is invalid or expired', { code: 'REFRESH_INVALID' });
      }

      // Rotação: cada refresh só pode ser usado uma vez.
      await persistence.revokeRefreshToken(stored.token_hash);
      const user = await requireUserById(stored.user_id);
      return buildTokenPair(user);
    },

    async logout({ refreshToken }) {
      if (refreshToken) {
        await persistence.revokeRefreshToken(hashRefreshToken(refreshToken));
      }
      return { loggedOut: true };
    },

    async setupTotp(userId) {
      const user = await requireUserById(userId);
      const secret = generateTotpSecret();
      const otpauthUri = buildOtpauthUri({
        secret,
        username: user.username,
        issuer: TOTP_ISSUER,
      });

      await persistence.updateUser(user.id, {
        totpSecretEncrypted: cryptoAdapter.encrypt(secret),
        totpEnabled: false,
      });

      // PNG em data URL para a UI exibir sem chamar serviço externo (segredo não sai da máquina).
      const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 240,
        color: { dark: '#0f1419', light: '#ffffff' },
      });

      return { secret, otpauthUri, qrCodeDataUrl };
    },

    async confirmTotp(userId, code) {
      const user = await requireUserById(userId);
      if (!user.totp_secret_encrypted) {
        throw new AuthError('TOTP setup was not started', {
          statusCode: 400,
          code: 'TOTP_NOT_CONFIGURED',
        });
      }

      const secret = cryptoAdapter.decrypt(user.totp_secret_encrypted);
      if (!verifyTotpCode(secret, code, { now })) {
        throw new AuthError('Invalid TOTP code', { code: 'INVALID_TOTP_CODE' });
      }

      await persistence.updateUser(user.id, { totpEnabled: true });
      return { totpEnabled: true };
    },

    async elevate(userId, code) {
      const user = await requireUserById(userId);
      if (!user.totp_secret_encrypted || !user.totp_enabled) {
        throw new AuthError('TOTP is not configured for this user', {
          statusCode: 400,
          code: 'TOTP_NOT_CONFIGURED',
        });
      }

      const secret = cryptoAdapter.decrypt(user.totp_secret_encrypted);
      if (!verifyTotpCode(secret, code, { now })) {
        throw new AuthError('Invalid TOTP code', { code: 'INVALID_TOTP_CODE' });
      }

      const elevationToken = signJwt(
        { sub: user.id, kind: 'elevation' },
        { secret: jwtSecret, expiresInSeconds: elevationTtlSeconds, now },
      );
      return { elevationToken, expiresInSeconds: elevationTtlSeconds };
    },

    verifyAccessToken(token) {
      const claims = verifyJwt(token, { secret: jwtSecret, now });
      if (claims.kind !== 'access') {
        throw new AuthError('Not an access token', { code: 'TOKEN_INVALID' });
      }
      return claims;
    },

    verifyElevationToken(token, expectedUserId) {
      const claims = verifyJwt(token, { secret: jwtSecret, now });
      if (claims.kind !== 'elevation' || claims.sub !== expectedUserId) {
        throw new AuthError('Elevation token is not valid for this session', {
          statusCode: 403,
          code: 'ELEVATION_REQUIRED',
        });
      }
      return claims;
    },

    getElevationTtlSeconds() {
      return elevationTtlSeconds;
    },

    getAccessTtlSeconds() {
      return accessTtlSeconds;
    },
  };
}

module.exports = {
  createAuthService,
  hashPassword,
  verifyPassword,
  isSubscriptionActive,
  subscriptionInfo,
};
