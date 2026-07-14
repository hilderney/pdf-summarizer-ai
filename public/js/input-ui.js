const {
  isAllowedInputFile,
  getInputFileType,
  formatFileSize,
  escapeHtml,
  fileToBase64,
  initDropZone,
} = window.fileInputUtils;

const pendingFiles = new Map();
let nextFileId = 0;
let isProcessing = false;

function logInput(message, isError = false) {
  const el = document.getElementById('files-log');
  const prefix = isError ? '[ERRO] ' : '';
  el.textContent += `${prefix}${message}\n`;
  el.scrollTop = el.scrollHeight;
  el.className = isError ? 'log error' : 'log';
}

function addPendingFiles(fileList) {
  const added = [];
  const skipped = [];

  for (const file of fileList) {
    if (!isAllowedInputFile(file.name)) {
      skipped.push(file.name);
      continue;
    }

    const key = `f-${nextFileId += 1}`;
    pendingFiles.set(key, { file, selected: true, key });
    added.push(file);
    logInput(`Adicionado: ${file.name} (${formatFileSize(file.size)})`);
  }

  if (skipped.length > 0) {
    logInput(`Ignorados (formato inválido): ${skipped.join(', ')}`, true);
  }

  if (fileList.length > 0 && added.length === 0) {
    throw new Error('Nenhum PDF ou planilha (.pdf, .xlsx, .xls) válido selecionado.');
  }

  renderPendingFiles();
  return added;
}

function removePendingFile(key) {
  const entry = pendingFiles.get(key);
  if (entry) {
    logInput(`Removido: ${entry.file.name}`);
  }
  pendingFiles.delete(key);
  renderPendingFiles();
}

function clearPendingFiles() {
  pendingFiles.clear();
  renderPendingFiles();
  document.getElementById('process-metadata').innerHTML = '';
}

function getSelectedPendingFiles() {
  return [...pendingFiles.values()].filter((entry) => entry.selected).map((entry) => entry.file);
}

function setProcessingState(active) {
  isProcessing = active;
  const btn = document.getElementById('btn-process-selected');
  const pickBtn = document.getElementById('btn-pick-files');
  const clearBtn = document.getElementById('btn-clear-files');
  const dropZone = document.getElementById('file-drop-zone');

  btn.disabled = active;
  pickBtn.disabled = active;
  clearBtn.disabled = active;
  dropZone.classList.toggle('drop-zone--uploading', active);
  btn.textContent = active ? 'Processando...' : 'Processar selecionados';
}

function renderPendingFiles() {
  const tbody = document.querySelector('#selected-files-table tbody');
  const selectAll = document.getElementById('select-all-files');
  tbody.innerHTML = '';

  const entries = [...pendingFiles.values()];
  if (entries.length === 0) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    document.getElementById('selection-summary').textContent =
      'Nenhum arquivo selecionado. Arraste arquivos ou use o botão abaixo.';
    return;
  }

  for (const entry of entries) {
    const type = getInputFileType(entry.file.name);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="col-check"><input type="checkbox" data-key="${entry.key}" ${entry.selected ? 'checked' : ''}></td>
      <td>${escapeHtml(entry.file.name)}</td>
      <td><span class="type-badge type-${type}">${type === 'pdf' ? 'PDF' : 'Planilha'}</span></td>
      <td>${formatFileSize(entry.file.size)}</td>
      <td><button type="button" class="btn-link btn-remove" data-remove="${entry.key}">Remover</button></td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const entry = pendingFiles.get(checkbox.dataset.key);
      if (entry) {
        entry.selected = checkbox.checked;
        updateSelectionSummary();
        updateSelectAllState();
      }
    });
  });

  tbody.querySelectorAll('[data-remove]').forEach((button) => {
    button.addEventListener('click', () => removePendingFile(button.dataset.remove));
  });

  updateSelectionSummary();
  updateSelectAllState();
}

function updateSelectionSummary() {
  const total = pendingFiles.size;
  const selected = getSelectedPendingFiles().length;
  const pdfs = getSelectedPendingFiles().filter((f) => getInputFileType(f.name) === 'pdf').length;
  const sheets = selected - pdfs;
  const el = document.getElementById('selection-summary');
  el.textContent =
    total === 0
      ? 'Nenhum arquivo selecionado.'
      : `${selected} de ${total} arquivo(s) marcado(s) — ${pdfs} PDF, ${sheets} planilha(s)`;
  el.className = selected > 0 ? 'hint success' : 'hint';
}

function updateSelectAllState() {
  const selectAll = document.getElementById('select-all-files');
  const entries = [...pendingFiles.values()];
  const selectedCount = entries.filter((entry) => entry.selected).length;
  selectAll.checked = entries.length > 0 && selectedCount === entries.length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < entries.length;
}

function renderProcessMetadata(results) {
  const container = document.getElementById('process-metadata');
  const spreadsheetResults = (results || []).filter((item) => item.type === 'spreadsheet' && item.metadata);

  if (spreadsheetResults.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = spreadsheetResults
    .map(
      (item) => `
      <p><strong>${escapeHtml(item.sourceFile)}</strong></p>
      <p>Prestador: ${escapeHtml(item.metadata.prestador || '-')}</p>
      <p>Produção: ${escapeHtml(item.metadata.dtPesquisaInicio || '-')} a ${escapeHtml(item.metadata.dtPesquisaFim || '-')}</p>
      <p>Pagamento: ${escapeHtml(item.metadata.paymentDate || '-')}</p>
    `,
    )
    .join('<hr>');
}

async function refreshOutputFilesTable() {
  const tbody = document.querySelector('#output-files-table tbody');
  tbody.innerHTML = '';

  try {
    const { files } = await api.listFiles();
    for (const file of files) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(file.name)}</td>
        <td class="file-actions">
          <a href="${file.url}" target="_blank" rel="noopener">Abrir</a>
          <a href="${file.url}" download="${escapeHtml(file.name)}" class="file-download">Download</a>
        </td>`;
      tbody.appendChild(tr);
    }
  } catch (error) {
    logInput(error.message, true);
  }
}

async function processSelectedFiles() {
  if (isProcessing) {
    return;
  }

  const selected = getSelectedPendingFiles();
  if (selected.length === 0) {
    throw new Error('Marque ao menos um arquivo para processar.');
  }

  setProcessingState(true);
  logInput(`Preparando ${selected.length} arquivo(s)...`);

  try {
    const payloadFiles = [];
    for (const file of selected) {
      logInput(`Lendo ${file.name}...`);
      const data = await fileToBase64(file);
      payloadFiles.push({ name: file.name, data });
    }

    logInput('Enviando e processando no servidor...');
    const summary = await api.inputRun(payloadFiles);

    logInput(`Concluído: ${summary.processed} processado(s), ${summary.failed} falha(s).`);

    for (const item of summary.results || []) {
      if (item.type === 'pdf') {
        logInput(`PDF ${item.sourceFile}: ${item.extracted} extraído(s).`);
      } else {
        logInput(`Planilha ${item.sourceFile}: ${item.rowCount} linha(s).`);
      }
    }

    for (const item of summary.errors || []) {
      logInput(`${item.sourceFile}: ${item.error}`, true);
    }

    renderProcessMetadata(summary.results);
    await refreshOutputFilesTable();
    window.dispatchEvent(new CustomEvent('files-updated'));
    return summary;
  } finally {
    setProcessingState(false);
  }
}

function handleIncomingFiles(files) {
  try {
    addPendingFiles(files);
  } catch (error) {
    logInput(error.message, true);
  }
}

function initInputUi() {
  const fileInput = document.getElementById('file-input');
  const dropZone = document.getElementById('file-drop-zone');
  const selectAll = document.getElementById('select-all-files');

  initDropZone(
    dropZone,
    fileInput,
    (files) => handleIncomingFiles(files),
    (error) => logInput(error.message || 'Falha ao receber arquivos.', true),
  );

  document.getElementById('btn-pick-files').addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    if (!fileInput.files?.length) {
      return;
    }
    handleIncomingFiles([...fileInput.files]);
    fileInput.value = '';
  });

  selectAll.addEventListener('change', () => {
    for (const entry of pendingFiles.values()) {
      entry.selected = selectAll.checked;
    }
    renderPendingFiles();
  });

  document.getElementById('btn-clear-files').addEventListener('click', () => {
    clearPendingFiles();
    logInput('Seleção limpa.');
  });

  document.getElementById('btn-process-selected').addEventListener('click', async () => {
    try {
      await processSelectedFiles();
    } catch (error) {
      logInput(error.message || 'Falha ao processar arquivos.', true);
      setProcessingState(false);
    }
  });

  refreshOutputFilesTable();
}

window.initInputUi = initInputUi;
window.refreshOutputFilesTable = refreshOutputFilesTable;
