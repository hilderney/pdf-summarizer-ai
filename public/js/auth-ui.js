// Controla login, elevação TOTP e visibilidade por role.
// A UI é só conveniência: o backend revalida role e elevação em toda rota.
function initAuthUi({ onAuthenticated }) {
  const TAB_ROLES = {
    files: ['ADM', 'USER'],
    logs: ['ADM'],
    models: ['ADM', 'USER'],
    process: ['ADM', 'USER'],
  };

  const loginScreen = document.getElementById('login-screen');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');

  const totpSetupModal = document.getElementById('totp-setup-modal');
  const totpSetupQr = document.getElementById('totp-setup-qr');
  const totpSetupSecret = document.getElementById('totp-setup-secret');
  const totpSetupUri = document.getElementById('totp-setup-uri');
  const totpSetupForm = document.getElementById('totp-setup-form');
  const totpSetupError = document.getElementById('totp-setup-error');

  const elevateModal = document.getElementById('elevate-modal');
  const elevateForm = document.getElementById('elevate-form');
  const elevateError = document.getElementById('elevate-error');

  const userBadge = document.getElementById('user-badge');
  const subscriptionBadge = document.getElementById('subscription-badge');
  const sessionCountdown = document.getElementById('session-countdown');
  const logoutButton = document.getElementById('btn-logout');

  let appInitialized = false;
  let lastSubscription = null;
  let countdownTimerId = null;
  let refreshingOnExpiry = false;

  function show(element) {
    element.classList.remove('hidden');
    element.removeAttribute('hidden');
  }

  function hide(element) {
    element.classList.add('hidden');
    element.setAttribute('hidden', '');
  }

  function formatCountdown(totalSeconds) {
    const safe = Math.max(0, totalSeconds);
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function stopSessionCountdown() {
    if (countdownTimerId != null) {
      clearInterval(countdownTimerId);
      countdownTimerId = null;
    }
    if (sessionCountdown) {
      sessionCountdown.textContent = '';
      sessionCountdown.classList.remove('session-countdown-urgent');
    }
  }

  function renderSessionCountdown() {
    if (!sessionCountdown || !sessionStore.isLoggedIn()) {
      stopSessionCountdown();
      return;
    }

    let expiresAt = sessionStore.accessExpiresAtMs;
    if (!expiresAt) {
      expiresAt = sessionStore.syncAccessExpiryFromToken();
    }
    if (!expiresAt) {
      sessionCountdown.textContent = '--:--';
      return;
    }

    const remainingSeconds = Math.ceil((expiresAt - Date.now()) / 1000);
    sessionCountdown.textContent = formatCountdown(remainingSeconds);
    sessionCountdown.classList.toggle('session-countdown-urgent', remainingSeconds <= 60);

    if (remainingSeconds <= 0 && !refreshingOnExpiry) {
      refreshingOnExpiry = true;
      api
        ._tryRefreshSession()
        .then((ok) => {
          if (!ok) {
            sessionStore.clear();
            window.dispatchEvent(new CustomEvent('auth:logged-out'));
            return;
          }
          startSessionCountdown();
        })
        .finally(() => {
          refreshingOnExpiry = false;
        });
    }
  }

  function startSessionCountdown() {
    stopSessionCountdown();
    if (!sessionStore.isLoggedIn()) {
      return;
    }
    if (!sessionStore.accessExpiresAtMs) {
      sessionStore.syncAccessExpiryFromToken();
    }
    renderSessionCountdown();
    countdownTimerId = setInterval(renderSessionCountdown, 1000);
  }

  function showLoginScreen() {
    stopSessionCountdown();
    document.body.classList.remove('authenticated');
    show(loginScreen);
    hide(totpSetupModal);
    hide(elevateModal);
    loginError.textContent = '';
    loginForm.reset();
    document.getElementById('login-username').focus();
  }

  function applyRoleToTabs(role) {
    const allowedTabs = Object.entries(TAB_ROLES)
      .filter(([, roles]) => roles.includes(role))
      .map(([tab]) => tab);

    document.querySelectorAll('.tab').forEach((tab) => {
      const isAllowed = allowedTabs.includes(tab.dataset.tab);
      tab.style.display = isAllowed ? '' : 'none';
    });

    // Garante que a aba ativa é uma permitida (USER cai em "Arquivos").
    const firstAllowed = document.querySelector(`.tab[data-tab="${allowedTabs[0]}"]`);
    if (firstAllowed && !allowedTabs.includes(document.querySelector('.tab.active')?.dataset.tab)) {
      firstAllowed.click();
    }
  }

  function formatSubscriptionBadge(subscription, role) {
    if (!subscriptionBadge) {
      return;
    }
    if (role === 'ADM') {
      subscriptionBadge.textContent = 'Assinatura: ilimitada';
      subscriptionBadge.classList.remove('subscription-expired');
      return;
    }
    if (!subscription) {
      subscriptionBadge.textContent = '';
      return;
    }
    if (subscription.active) {
      const until = subscription.expiresAt
        ? new Date(subscription.expiresAt).toLocaleDateString('pt-BR')
        : '—';
      subscriptionBadge.textContent = `Assinatura até ${until}`;
      subscriptionBadge.classList.remove('subscription-expired');
    } else {
      subscriptionBadge.textContent = 'Assinatura expirada — contate o administrador';
      subscriptionBadge.classList.add('subscription-expired');
    }
  }

  function enterApp(user, subscription = null) {
    hide(loginScreen);
    hide(totpSetupModal);
    document.body.classList.add('authenticated');
    userBadge.textContent = `${user.username} (${user.role})`;
    lastSubscription = subscription;
    formatSubscriptionBadge(subscription, user.role);
    applyRoleToTabs(user.role);
    startSessionCountdown();

    if (!appInitialized) {
      appInitialized = true;
      onAuthenticated();
    }
  }

  async function startTotpSetup() {
    const { secret, otpauthUri, qrCodeDataUrl } = await api.totpSetup();
    totpSetupQr.src = qrCodeDataUrl;
    totpSetupQr.alt = `QR Code TOTP para ${sessionStore.user?.username || 'usuário'}`;
    totpSetupSecret.textContent = secret;
    totpSetupUri.textContent = otpauthUri;
    totpSetupError.textContent = '';
    totpSetupForm.reset();
    hide(loginScreen);
    show(totpSetupModal);
    document.getElementById('totp-setup-code').focus();
  }

  async function handleLoginSubmit(event) {
    event.preventDefault();
    loginError.textContent = '';

    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    try {
      const session = await api.login(username, password);
      sessionStore.saveSession(session);
      if (session.user.totpEnabled) {
        const me = await api.authMe();
        enterApp(me.user, me.subscription);
      } else {
        await startTotpSetup();
      }
    } catch (error) {
      loginError.textContent =
        error.code === 'INVALID_CREDENTIALS' ? 'Usuário ou senha inválidos.' : error.message;
    }
  }

  async function handleTotpSetupSubmit(event) {
    event.preventDefault();
    totpSetupError.textContent = '';

    try {
      await api.totpConfirm(document.getElementById('totp-setup-code').value.trim());
      sessionStore.markTotpEnabled();
      const me = await api.authMe();
      enterApp(me.user, me.subscription);
    } catch (error) {
      totpSetupError.textContent =
        error.code === 'INVALID_TOTP_CODE' ? 'Código inválido. Tente novamente.' : error.message;
    }
  }

  async function handleElevateSubmit(event) {
    event.preventDefault();
    elevateError.textContent = '';

    try {
      const elevation = await api.elevate(document.getElementById('elevate-code').value.trim());
      sessionStore.saveElevation(elevation);
      hide(elevateModal);
      elevateForm.reset();
    } catch (error) {
      elevateError.textContent =
        error.code === 'INVALID_TOTP_CODE' ? 'Código inválido. Tente novamente.' : error.message;
    }
  }

  function showElevateModal() {
    if (!sessionStore.isLoggedIn()) {
      return;
    }
    elevateError.textContent = '';
    elevateForm.reset();
    show(elevateModal);
    document.getElementById('elevate-code').focus();
  }

  async function handleLogout() {
    stopSessionCountdown();
    const refreshToken = sessionStore.refreshToken;
    sessionStore.clear();
    try {
      if (refreshToken) {
        await api.logout(refreshToken);
      }
    } catch {
      // Sessão local já foi limpa; falha na revogação remota não impede o logout.
    }
    window.location.reload();
  }

  async function restoreSessionOrShowLogin() {
    sessionStore.load();
    if (!sessionStore.isLoggedIn()) {
      showLoginScreen();
      return;
    }

    try {
      const me = await api.authMe();
      if (!sessionStore.accessExpiresAtMs) {
        sessionStore.syncAccessExpiryFromToken();
      }
      if (me.user.totpEnabled) {
        enterApp(me.user, me.subscription);
      } else {
        await startTotpSetup();
      }
    } catch {
      sessionStore.clear();
      showLoginScreen();
    }
  }

  function showSubscriptionExpired() {
    formatSubscriptionBadge({ active: false }, sessionStore.user?.role || 'USER');
    window.alert('Sua assinatura expirou. Contate o administrador para renovar o acesso.');
  }

  loginForm.addEventListener('submit', handleLoginSubmit);
  totpSetupForm.addEventListener('submit', handleTotpSetupSubmit);
  elevateForm.addEventListener('submit', handleElevateSubmit);
  logoutButton.addEventListener('click', handleLogout);
  document
    .querySelectorAll('[data-elevate-dismiss]')
    .forEach((el) => el.addEventListener('click', () => hide(elevateModal)));

  window.addEventListener('auth:elevation-required', showElevateModal);
  window.addEventListener('auth:subscription-expired', showSubscriptionExpired);
  window.addEventListener('auth:logged-out', showLoginScreen);
  window.addEventListener('auth:session-refreshed', () => {
    startSessionCountdown();
  });

  restoreSessionOrShowLogin();
}

window.initAuthUi = initAuthUi;
