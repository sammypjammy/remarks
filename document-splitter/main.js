import { zipSync } from 'fflate';
import { splitContract, makeSplits, INTAKE_CONTRACT_PIECES } from './splits.js';
import { documentName, intakeDocumentName, uniqueDocumentName } from './names.js';

const input = document.getElementById('documentFiles');
const results = document.getElementById('documentResults');
const status = document.getElementById('splitterStatus');
const downloadAll = document.getElementById('downloadAll');
const documentType = document.getElementById('documentType');
const otherControls = document.getElementById('otherControls');
const otherHint = document.getElementById('otherHint');
const setupDescription = document.getElementById('setupDescription');
const pieceCount = document.getElementById('pieceCount');
const pieceFields = document.getElementById('pieceFields');
const setupError = document.getElementById('setupError');
let documents = [];
let usedNames = new Set();
let otherPieces = ['1-4', '5-7', '10', '11'].map(selection => ({ selection, name: '' }));

for (let count = 1; count <= 12; count++) {
  const option = document.createElement('option');
  option.value = String(count);
  option.textContent = String(count);
  pieceCount.append(option);
}
pieceCount.value = String(otherPieces.length);

function clearOutputs() {
  documents = [];
  usedNames = new Set();
  results.replaceChildren();
  downloadAll.disabled = true;
  status.textContent = 'Choose PDFs to begin.';
}

function renderPieces() {
  pieceFields.replaceChildren();
  const isOther = documentType.value === 'other';
  otherControls.hidden = !isOther;
  otherHint.hidden = !isOther;
  setupDescription.textContent = isOther
    ? 'Choose pages and optionally name each piece.'
    : 'Intake Contracts creates four ready-named PDFs.';
  if (!isOther) {
    for (const piece of INTAKE_CONTRACT_PIECES) {
      const card = document.createElement('div');
      card.className = 'splitter-preset-piece';
      const name = document.createElement('strong');
      name.textContent = piece.name;
      const pages = document.createElement('span');
      pages.textContent = `Pages ${piece.selection}`;
      card.append(name, pages);
      pieceFields.append(card);
    }
    return;
  }
  otherPieces.forEach((piece, index) => {
    const card = document.createElement('div');
    card.className = 'splitter-piece';
    const heading = document.createElement('strong');
    heading.textContent = `Piece ${index + 1}`;
    const pageLabel = document.createElement('label');
    pageLabel.textContent = 'Pages';
    const pages = document.createElement('input');
    pages.className = 'splitter-page-input';
    pages.type = 'text';
    pages.autocomplete = 'off';
    pages.spellcheck = false;
    pages.placeholder = 'e.g. 1-4 or 1, 3, 5-7';
    pages.value = piece.selection;
    pages.addEventListener('input', () => {
      piece.selection = pages.value;
      setupError.hidden = true;
      pages.setCustomValidity('');
      clearOutputs();
    });
    pageLabel.append(pages);
    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Name (optional)';
    const name = document.createElement('input');
    name.type = 'text';
    name.autocomplete = 'off';
    name.placeholder = 'e.g. Medical Records';
    name.value = piece.name;
    name.addEventListener('input', () => {
      piece.name = name.value;
      clearOutputs();
    });
    nameLabel.append(name);
    card.append(heading, pageLabel, nameLabel);
    pieceFields.append(card);
  });
}

documentType.addEventListener('change', () => {
  setupError.hidden = true;
  clearOutputs();
  renderPieces();
});

pieceCount.addEventListener('change', () => {
  const count = Number(pieceCount.value);
  otherPieces = Array.from({ length: count }, (_, index) => otherPieces[index] || { selection: '', name: '' });
  setupError.hidden = true;
  clearOutputs();
  renderPieces();
});
renderPieces();

function selectedSplits() {
  if (documentType.value === 'intake') return makeSplits(INTAKE_CONTRACT_PIECES);
  for (const [index, field] of [...pieceFields.querySelectorAll('.splitter-page-input')].entries()) {
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
  return makeSplits(otherPieces);
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
      const baseName = documentType.value === 'intake'
        ? intakeDocumentName(item.range.name)
        : documentName(file.name, item.range.selection, item.range.name);
      const name = uniqueDocumentName(baseName, usedNames);
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
  documentType.disabled = true;
  pieceCount.disabled = true;
  pieceFields.querySelectorAll('input').forEach(field => { field.disabled = true; });
  status.textContent = `Processing ${files.length} ${files.length === 1 ? 'PDF' : 'PDFs'}…`;
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
  documentType.disabled = false;
  pieceCount.disabled = false;
  pieceFields.querySelectorAll('input').forEach(field => { field.disabled = false; });
  downloadAll.disabled = documents.length === 0;
  status.textContent = `${documents.length} PDFs ready${failed ? `; ${failed} ${failed === 1 ? 'file' : 'files'} could not be processed` : ''}.`;
});

downloadAll.addEventListener('click', () => {
  if (!documents.length) return;
  const entries = Object.fromEntries(documents.map(({ name, bytes }) => [name, bytes]));
  download(zipSync(entries), 'document-splits.zip', 'application/zip');
});
