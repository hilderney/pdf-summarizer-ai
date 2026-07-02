function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function createFolderPicker({ onSelect }) {
  const modal = document.getElementById('folder-picker-modal');
  const listEl = document.getElementById('picker-list');
  const rootsEl = document.getElementById('picker-roots');
  const breadcrumbEl = document.getElementById('picker-breadcrumb');
  const statusEl = document.getElementById('picker-status');
  let currentPath = null;
  let currentBrowse = null;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function openModal(startPath = null) {
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    rootsEl.classList.add('hidden');
    listEl.classList.remove('hidden');
    if (startPath) {
      loadPath(startPath);
    } else {
      loadDefault();
    }
  }

  function closeModal() {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }

  async function loadDefault() {
    const { defaultPath } = await api.fsRoots();
    await loadPath(defaultPath);
  }

  async function loadPath(targetPath) {
    try {
      const browse = await api.fsBrowse(targetPath);
      currentPath = browse.currentPath;
      currentBrowse = browse;
      renderBrowse(browse);
    } catch (error) {
      setStatus(`Erro: ${error.message}`);
    }
  }

  function renderBreadcrumb(current) {
    breadcrumbEl.textContent = current;
    breadcrumbEl.title = current;
  }

  function renderBrowse(browse) {
    renderBreadcrumb(browse.currentPath);
    listEl.innerHTML = '';

    for (const dir of browse.directories) {
      const li = document.createElement('li');
      li.className = 'picker-item directory';
      li.innerHTML = `<span class="picker-icon">📁</span><span class="picker-name">${dir.name}</span>`;
      li.addEventListener('dblclick', () => loadPath(dir.path));
      li.addEventListener('click', () => {
        listEl.querySelectorAll('.picker-item').forEach((el) => el.classList.remove('selected'));
        li.classList.add('selected');
      });
      listEl.appendChild(li);
    }

    for (const pdf of browse.pdfs) {
      const li = document.createElement('li');
      li.className = 'picker-item pdf';
      li.innerHTML = `<span class="picker-icon">📄</span><span class="picker-name">${pdf.name}</span><span class="picker-meta">${formatBytes(pdf.sizeBytes)}</span>`;
      listEl.appendChild(li);
    }

    if (browse.directories.length === 0 && browse.pdfs.length === 0) {
      const li = document.createElement('li');
      li.className = 'picker-empty';
      li.textContent = 'Nenhuma subpasta ou PDF neste diretório.';
      listEl.appendChild(li);
    }

    setStatus(`${browse.pdfCount} PDF(s) nesta pasta`);
  }

  async function showRoots() {
    const { roots } = await api.fsRoots();
    rootsEl.classList.remove('hidden');
    listEl.classList.add('hidden');
    rootsEl.innerHTML = '';

    for (const root of roots) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'root-item';
      btn.textContent = root.name;
      btn.title = root.path;
      btn.addEventListener('click', () => {
        rootsEl.classList.add('hidden');
        listEl.classList.remove('hidden');
        loadPath(root.path);
      });
      rootsEl.appendChild(btn);
    }

    setStatus('Escolha um local inicial');
  }

  modal.querySelectorAll('[data-close-modal]').forEach((el) => {
    el.addEventListener('click', closeModal);
  });

  document.getElementById('picker-btn-up').addEventListener('click', () => {
    if (currentBrowse?.parentPath) {
      loadPath(currentBrowse.parentPath);
    }
  });

  document.getElementById('picker-btn-roots').addEventListener('click', showRoots);

  document.getElementById('picker-btn-select').addEventListener('click', () => {
    if (!currentPath) return;
    onSelect({
      inputDir: currentPath,
      pdfCount: currentBrowse?.pdfCount ?? 0,
      source: 'browse',
    });
    closeModal();
  });

  return { openModal, closeModal };
}

window.createFolderPicker = createFolderPicker;
