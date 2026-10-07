import { zipSync } from 'fflate';
import { splitContract, makeSplits } from './splits.js';
import { documentName, uniqueDocumentName } from './names.js';

const input = document.getElementById('contractFiles');
const results = document.getElementById('contractResults');
const status = document.getElementById('splitterStatus');
const downloadAll = document.getElementById('downloadAll');
const pieceCount = document.getElementById('pieceCount');
const pieceFields = document.getElementById('pieceFields');
const setupError = document.getElementById('setupError');
let documents = [];
let usedNames = new Set();
let selections = ['1-4', '5-7', '10', '11'];

for (let count = 1; count <= 12; count++) {
  const option = document.createElement('option');
  option.value = String(count);
  option.textContent = String(count);
  pieceCount.append(option);
}
pieceCount.value = String(selections.length);

function clearOutputs() {
  documents = [];
  usedNames = new Set();
  results.replaceChildren();
  downloadAll.disabled = true;
  status.textContent = 'Choose contracts to begin.';
}

function renderPieces() {
  pieceFields.replaceChildren();
  selections.forEach((value, index) => {
    const label = document.createElement('label');
    label.className = 'splitter-piece';
    const title = document.createElement('span');
    title.textContent = `Piece ${index + 1} pages`;
    const field = document.createElement('input');
    field.type = 'text';
    field.inputMode = 'text';
    field.autocomplete = 'off';
    field.spellcheck = false;
    field.placeholder = 'e.g. 1-4 or 1, 3, 5-7';
    field.value = value;
    field.addEventListener('input', () => {
      selections[index] = field.value;
      setupError.hidden = true;
      field.setCustomValidity('');
      clearOutputs();
    });
    label.append(title, field);
    pieceFields.append(label);
  });
}

pieceCount.addEventListener('change', () => {
  const count = Number(pieceCount.value);
  selections = Array.from({ length: count }, (_, index) => selections[index] || '');
  setupError.hidden = true;
  clearOutputs();
  renderPieces();
});
renderPieces();

function selectedSplits() {
  for (const [index, field] of [...pieceFields.querySelectorAll('input')].entries()) {
    try {
      makeSplits([field.value]);
      field.setCustomValidity('');
    } catch (error) {
      field.setCustomValidity(error.message);
      field.reportValidity();
      setupError.textContent = `Piece ${index + 1}: ${error.message}`;
      setupError.hidden = false;
      field.focus();
      return null;
    }
  }
  setupError.hidden = true;
  return makeSplits(selections);
}

function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function addContract(file, result) {
  const section = document.createElement('section');
  section.className = 'splitter-contract panel';
  const heading = document.createElement('div');
  heading.className = 'splitter-contract-heading';
  const title = document.createElement('h3');
  title.textContent = file.name;
  const count = document.createElement('span');
  count.textContent = `${result.pageCount} ${result.pageCount === 1 ? 'page' : 'pages'}`;
  heading.append(title, count);
  section.append(heading);
  const list = document.createElement('ul');
  for (const item of result.results) {
    const row = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = item.range.label;
    row.append(label);
    if (item.missing) {
      const missing = document.createElement('span');
      missing.className = 'splitter-missing';
      missing.textContent = `Unavailable — missing ${item.missingPages.length === 1 ? 'page' : 'pages'} ${item.missingPages.join(', ')}`;
      row.append(missing);
    } else {
      const name = uniqueDocumentName(documentName(file.name, item.range.selection), usedNames);
      const button = document.createElement('button');
      button.className = 'secondary-btn';
      button.type = 'button';
      button.textContent = 'Download PDF';
      button.setAttribute('aria-label', `Download ${item.range.label} from ${file.name}`);
      button.addEventListener('click', () => download(item.bytes, name, 'application/pdf'));
      row.append(button);
      documents.push({ name, bytes: item.bytes });
    }
    list.append(row);
  }
  section.append(list);
  results.append(section);
}

input.addEventListener('change', async () => {
  const files = Array.from(input.files || []);
  if (!files.length) return;
  const splits = selectedSplits();
  if (!splits) { input.value = ''; return; }
  clearOutputs();
  input.disabled = true;
  pieceCount.disabled = true;
  pieceFields.querySelectorAll('input').forEach(field => { field.disabled = true; });
  status.textContent = `Processing ${files.length} ${files.length === 1 ? 'contract' : 'contracts'}…`;
  let failed = 0;
  for (const file of files) {
    try {
      if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) throw new Error('Choose a PDF file.');
      const result = await splitContract(await file.arrayBuffer(), splits);
      addContract(file, result);
    } catch {
      failed++;
      const message = document.createElement('p');
      message.className = 'splitter-error panel';
      message.textContent = `${file.name}: This PDF could not be processed. Check that it is a valid, unlocked PDF.`;
      results.append(message);
    }
  }
  input.value = '';
  input.disabled = false;
  pieceCount.disabled = false;
  pieceFields.querySelectorAll('input').forEach(field => { field.disabled = false; });
  downloadAll.disabled = documents.length === 0;
  status.textContent = `${documents.length} PDFs ready${failed ? `; ${failed} ${failed === 1 ? 'file' : 'files'} could not be processed` : ''}.`;
});

downloadAll.addEventListener('click', () => {
  if (!documents.length) return;
  const entries = Object.fromEntries(documents.map(({ name, bytes }) => [name, bytes]));
  download(zipSync(entries), 'contract-splits.zip', 'application/zip');
});
