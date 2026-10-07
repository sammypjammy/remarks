import { zipSync } from 'fflate';
import { splitContract } from './splits.js';

const input = document.getElementById('contractFiles');
const results = document.getElementById('contractResults');
const status = document.getElementById('splitterStatus');
const downloadAll = document.getElementById('downloadAll');
let documents = [];

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

function safeBase(name) {
  return name.replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'contract';
}

function addContract(file, result, batchIndex) {
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
  const base = safeBase(file.name);
  for (const item of result.results) {
    const row = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = item.range.label;
    row.append(label);
    if (item.missing) {
      const missing = document.createElement('span');
      missing.className = 'splitter-missing';
      missing.textContent = `Unavailable — needs page ${item.range.end}`;
      row.append(missing);
    } else {
      const name = `${base}-${item.range.suffix}.pdf`;
      const button = document.createElement('button');
      button.className = 'secondary-btn';
      button.type = 'button';
      button.textContent = 'Download PDF';
      button.setAttribute('aria-label', `Download ${item.range.label} from ${file.name}`);
      button.addEventListener('click', () => download(item.bytes, name, 'application/pdf'));
      row.append(button);
      documents.push({ name: `${String(batchIndex + 1).padStart(2, '0')}-${name}`, bytes: item.bytes });
    }
    list.append(row);
  }
  section.append(list);
  results.append(section);
}

input.addEventListener('change', async () => {
  const files = Array.from(input.files || []);
  if (!files.length) return;
  documents = [];
  results.replaceChildren();
  downloadAll.disabled = true;
  input.disabled = true;
  status.textContent = `Processing ${files.length} ${files.length === 1 ? 'contract' : 'contracts'}…`;
  let failed = 0;
  for (const [index, file] of files.entries()) {
    try {
      if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) throw new Error('Choose a PDF file.');
      const result = await splitContract(await file.arrayBuffer());
      addContract(file, result, index);
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
  downloadAll.disabled = documents.length === 0;
  status.textContent = `${documents.length} PDFs ready${failed ? `; ${failed} ${failed === 1 ? 'file' : 'files'} could not be processed` : ''}.`;
});

downloadAll.addEventListener('click', () => {
  if (!documents.length) return;
  const entries = Object.fromEntries(documents.map(({ name, bytes }) => [name, bytes]));
  download(zipSync(entries), 'contract-splits.zip', 'application/zip');
});
