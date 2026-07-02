function logPipeline(message, isError = false) {
  const el = document.getElementById('pipeline-log');
  const prefix = isError ? '[ERRO] ' : '';
  el.textContent += `${prefix}${message}\n`;
  el.className = isError ? 'log error' : 'log';
}

function setSelectedInputDir(inputDir, info = '') {
  document.getElementById('pipeline-input-dir').value = inputDir;
  const infoEl = document.getElementById('pipeline-selection-info');
  infoEl.textContent = info || inputDir;
  infoEl.className = info ? 'hint success' : 'hint';
}

async function refreshFilesTable() {
  const tbody = document.querySelector('#files-table tbody');
  tbody.innerHTML = '';

  try {
    const { files } = await api.listFiles();
    for (const file of files) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${file.name}</td>
        <td class="file-actions">
          <a href="${file.url}" target="_blank" rel="noopener">Abrir</a>
          <a href="${file.url}" download="${file.name}" class="file-download">Download</a>
        </td>`;
      tbody.appendChild(tr);
    }
  } catch (error) {
    logPipeline(error.message, true);
  }
}

function filterPdfFiles(fileList) {
  return [...fileList].filter((file) => /\.pdf$/i.test(file.name));
}

async function uploadPdfFiles(fileList) {
  const pdfs = filterPdfFiles(fileList);
  if (pdfs.length === 0) {
    throw new Error('Nenhum PDF selecionado.');
  }

  logPipeline(`Enviando ${pdfs.length} PDF(s)...`);

  const files = await Promise.all(
    pdfs.map(async (file) => ({
      name: file.name,
      data: arrayBufferToBase64(await file.arrayBuffer()),
    })),
  );

  const staged = await api.stagePdfs(files);
  setSelectedInputDir(
    staged.inputDir,
    `${staged.pdfCount} PDF(s) enviados — prontos para processar`,
  );
  logPipeline(`Upload concluído: ${staged.pdfCount} PDF(s) em staging.`);
  return staged;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function traverseEntry(entry, files) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => {
      entry.file(resolve, reject);
    });
    if (/\.pdf$/i.test(file.name)) {
      files.push(file);
    }
    return;
  }

  if (!entry.isDirectory) {
    return;
  }

  const reader = entry.createReader();
  const readBatch = () =>
    new Promise((resolve, reject) => {
      reader.readEntries(async (entries) => {
        if (!entries.length) {
          resolve();
          return;
        }
        try {
          await Promise.all(entries.map((child) => traverseEntry(child, files)));
          await readBatch();
          resolve();
        } catch (error) {
          reject(error);
        }
      }, reject);
    });

  await readBatch();
}

async function collectFilesFromDataTransfer(dataTransfer) {
  const files = [];
  const items = dataTransfer?.items;

  if (items?.length) {
    const entries = [];
    for (const item of items) {
      if (item.kind === 'file' && item.webkitGetAsEntry) {
        const entry = item.webkitGetAsEntry();
        if (entry) {
          entries.push(entry);
        }
      }
    }

    if (entries.length) {
      await Promise.all(entries.map((entry) => traverseEntry(entry, files)));
      if (files.length) {
        return files;
      }
    }
  }

  return [...(dataTransfer?.files || [])];
}

function initDropZone(dropZone, pdfFileInput, onFiles) {
  let dragDepth = 0;

  const setActive = (active) => {
    dropZone.classList.toggle('drop-zone--active', active);
  };

  const setUploading = (uploading) => {
    dropZone.classList.toggle('drop-zone--uploading', uploading);
  };

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (eventName === 'dragenter') {
        dragDepth += 1;
      }
      setActive(true);
    });
  });

  dropZone.addEventListener('dragleave', (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepth -= 1;
    if (dragDepth <= 0) {
      dragDepth = 0;
      setActive(false);
    }
  });

  dropZone.addEventListener('drop', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepth = 0;
    setActive(false);

    try {
      const files = await collectFilesFromDataTransfer(event.dataTransfer);
      if (!files.length) {
        logPipeline('Nenhum arquivo recebido no drop.', true);
        return;
      }
      setUploading(true);
      await onFiles(files);
    } catch (error) {
      logPipeline(error.message, true);
    } finally {
      setUploading(false);
    }
  });

  dropZone.addEventListener('click', () => {
    pdfFileInput.click();
  });

  dropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pdfFileInput.click();
    }
  });
}

function initPipelineUi() {
  const folderPicker = createFolderPicker({
    onSelect: ({ inputDir, pdfCount }) => {
      setSelectedInputDir(
        inputDir,
        pdfCount > 0
          ? `Pasta selecionada — ${pdfCount} PDF(s) encontrado(s)`
          : 'Pasta selecionada — nenhum PDF neste nível (podem estar em subpastas)',
      );
      logPipeline(`Pasta selecionada: ${inputDir}`);
    },
  });

  const pdfFileInput = document.getElementById('pdf-file-input');
  const pdfFolderInput = document.getElementById('pdf-folder-input');
  const dropZone = document.getElementById('pdf-drop-zone');

  initDropZone(dropZone, pdfFileInput, uploadPdfFiles);

  document.getElementById('btn-browse-folder').addEventListener('click', () => {
    const current = document.getElementById('pipeline-input-dir').value.trim();
    folderPicker.openModal(current || null);
  });

  document.getElementById('btn-pick-pdfs').addEventListener('click', () => {
    pdfFileInput.click();
  });

  document.getElementById('btn-pick-folder-upload').addEventListener('click', () => {
    pdfFolderInput.click();
  });

  pdfFileInput.addEventListener('change', async () => {
    if (!pdfFileInput.files?.length) return;
    try {
      await uploadPdfFiles(pdfFileInput.files);
    } catch (error) {
      logPipeline(error.message, true);
    } finally {
      pdfFileInput.value = '';
    }
  });

  pdfFolderInput.addEventListener('change', async () => {
    if (!pdfFolderInput.files?.length) return;
    try {
      await uploadPdfFiles(pdfFolderInput.files);
    } catch (error) {
      logPipeline(error.message, true);
    } finally {
      pdfFolderInput.value = '';
    }
  });

  document.getElementById('btn-scan').addEventListener('click', async () => {
    const inputDir = document.getElementById('pipeline-input-dir').value.trim();
    if (!inputDir) {
      logPipeline('Selecione uma pasta ou envie PDFs.', true);
      return;
    }

    try {
      const result = await api.pipelineScan(inputDir);
      logPipeline(`Encontrados ${result.pdfs.length} PDF(s).`);
      setSelectedInputDir(inputDir, `${result.pdfs.length} PDF(s) encontrado(s) no scan`);
    } catch (error) {
      logPipeline(error.message, true);
    }
  });

  document.getElementById('btn-run').addEventListener('click', async () => {
    const inputDir = document.getElementById('pipeline-input-dir').value.trim();
    if (!inputDir) {
      logPipeline('Selecione uma pasta ou envie PDFs.', true);
      return;
    }

    try {
      logPipeline('Executando pipeline...');
      const summary = await api.pipelineRun(inputDir);
      logPipeline(
        `Concluído: ${summary.extracted} extraído(s), ${summary.failed} falha(s).`,
      );
      await refreshFilesTable();
      window.dispatchEvent(new CustomEvent('files-updated'));
    } catch (error) {
      logPipeline(error.message, true);
    }
  });

  refreshFilesTable();
}

window.initPipelineUi = initPipelineUi;
window.refreshFilesTable = refreshFilesTable;
window.setSelectedInputDir = setSelectedInputDir;
