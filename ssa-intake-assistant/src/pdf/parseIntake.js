import { createClientProfile, createField } from '../model/client-schema.js';
import { normalizeExtractedValue } from '../model/validation.js';

const DEFINITIONS = [
  {
    path: 'personal.firstName',
    labels: ['first name', 'given name'],
    kind: 'name',
    blockedPrefix: /(?:mother|father|different name|other|at birth)\s*-?\s*$/i,
  },
  { path: 'personal.middleName', labels: ['middle name', 'middle initial'], kind: 'name' },
  {
    path: 'personal.lastName',
    labels: ['last name', 'surname'],
    kind: 'name',
    blockedPrefix: /(?:father|different name|other|at birth)\s*-?\s*$/i,
  },
  { path: 'personal.suffix', labels: ['suffix'], kind: 'suffix' },
  { path: 'personal.ssn', labels: ['social security number', 'ssn'], kind: 'ssn' },
  { path: 'personal.dateOfBirth', labels: ['date of birth', 'birth date', 'dob'], kind: 'date' },
  {
    path: 'contact.phone',
    labels: ['primary phone', 'phone number', 'daytime phone', 'phone'],
    kind: 'phone',
    blockedPrefix: /(?:emergency contact|school|training|work|employer|provider)\s*-?\s*$/i,
  },
  { path: 'contact.alternatePhone', labels: ['alternate phone', 'secondary phone'], kind: 'phone' },
  { path: 'contact.email', labels: ['email address', 'email'], kind: 'email' },
  {
    path: 'contact.mailingAddress.street1',
    labels: ['mailing address - street address', 'mailing address - street', 'mailing street address'],
    formLabels: ['mailingaddress'],
    kind: 'address',
  },
  {
    path: 'contact.mailingAddress.street2',
    labels: ['mailing address line 2', 'mailing apartment'],
    kind: 'address',
  },
  { path: 'contact.mailingAddress.city', labels: ['mailing address - city', 'mailing city'], kind: 'city' },
  { path: 'contact.mailingAddress.state', labels: ['mailing address - state', 'mailing state'], kind: 'state' },
  {
    path: 'contact.mailingAddress.zip',
    labels: ['mailing address - zipcode', 'mailing address - zip code', 'mailing zip code', 'postal code'],
    kind: 'zip',
  },
];

export function parseIntakePages(pages, fileName = '', formFields = [], diagnostics = {}) {
  const profile = createClientProfile();
  profile.source = {
    fileName,
    pageCount: pages.length,
    diagnostics: { ...diagnostics, parserCandidateCount: 0, parserRejectedCount: 0 },
  };
  const candidates = new Map();

  for (const page of pages) {
    const lines = page.text.split(/\r?\n/).map(cleanLine).filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const occurrences = findLabelOccurrences(line);

      for (let occurrenceIndex = 0; occurrenceIndex < occurrences.length; occurrenceIndex += 1) {
        const occurrence = occurrences[occurrenceIndex];
        const nextOccurrence = occurrences[occurrenceIndex + 1];
        let rawValue = line.slice(occurrence.end, nextOccurrence?.start ?? line.length);

        if (!stripValueDecorations(rawValue) && isStandaloneLabel(line, occurrence)) {
          const nextLine = lines[index + 1];
          if (nextLine && findLabelOccurrences(nextLine).length === 0) rawValue = nextLine;
        }

        addCandidate(candidates, occurrence.definition, rawValue, {
          page: page.pageNumber,
          fromOcr: Boolean(page.ocrUsed),
          labelSpecificity: occurrence.label.length,
        }, profile.source.diagnostics);
      }
    }
  }

  for (const formField of formFields) {
    const definition = findDefinitionForFormField(formField.label);
    if (!definition) continue;
    addCandidate(candidates, definition, formField.value, {
      page: formField.pageNumber,
      fromFormField: true,
      labelSpecificity: 40,
    }, profile.source.diagnostics);
  }

  for (const definition of DEFINITIONS) {
    const ranked = deduplicate(candidates.get(definition.path) ?? [])
      .sort((a, b) => b.score - a.score);
    if (!ranked.length) continue;

    const first = ranked[0];
    const competing = ranked.filter((item) =>
      item.value.toLowerCase() !== first.value.toLowerCase() && first.score - item.score <= 10,
    );
    const conflict = competing.length > 0;
    setAtPath(
      profile,
      definition.path,
      createField(first.value, {
        status: conflict ? 'conflict' : 'needs_review',
        sourcePage: first.page,
        confidence: conflict ? 0.45 : scoreToConfidence(first.score),
        notes: conflict ? `Other similarly ranked value: ${competing[0].value}` : sourceNote(first),
      }),
    );
  }

  return profile;
}

function findLabelOccurrences(line) {
  const occurrences = [];
  for (const definition of DEFINITIONS) {
    for (const label of definition.labels) {
      const pattern = flexibleLabelPattern(label);
      for (const match of line.matchAll(pattern)) {
        const prefix = line.slice(Math.max(0, match.index - 35), match.index);
        if (definition.blockedPrefix?.test(prefix)) continue;
        occurrences.push({
          definition,
          label,
          start: match.index,
          end: match.index + match[0].length,
        });
      }
    }
  }

  return occurrences
    .sort((a, b) => a.start - b.start || b.label.length - a.label.length)
    .filter((item, index, all) =>
      !all.slice(0, index).some((kept) => item.start < kept.end && item.end > kept.start),
    );
}

function flexibleLabelPattern(label) {
  const words = normalizeLabel(label).split(' ').filter(Boolean);
  const body = words.map(escapeRegExp).join('[\\s_#:\\-–—.]*');
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])\\s*:?`, 'gi');
}

function addCandidate(collection, definition, rawValue, source, diagnostics) {
  const normalized = normalizeCandidate(rawValue, definition.kind);
  if (!normalized) {
    if (stripValueDecorations(rawValue)) diagnostics.parserRejectedCount += 1;
    return;
  }

  const score = (source.fromFormField ? 90 : source.fromOcr ? 55 : 75)
    + Math.min(10, Math.floor(source.labelSpecificity / 5))
    + normalized.quality;
  const items = collection.get(definition.path) ?? [];
  items.push({ value: normalized.value, score, ...source });
  collection.set(definition.path, items);
  diagnostics.parserCandidateCount += 1;
}

function normalizeCandidate(rawValue, kind = 'text') {
  const value = normalizeExtractedValue(stripValueDecorations(rawValue), kind);
  if (!value) return null;

  if (kind === 'email') {
    const match = value.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i);
    return match ? { value: match[0], quality: 10 } : null;
  }
  if (kind === 'ssn') {
    const match = value.match(/(?<!\d)(\d{3})[\s-]?(\d{2})[\s-]?(\d{4})(?!\d)/);
    return match ? { value: `${match[1]}-${match[2]}-${match[3]}`, quality: 10 } : null;
  }
  if (kind === 'phone') {
    const match = value.match(/(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?([2-9]\d{2})[\s.-]?(\d{4})/);
    return match ? { value: `(${match[1]}) ${match[2]}-${match[3]}`, quality: 10 } : null;
  }
  if (kind === 'date') {
    const match = value.match(/\b\d{1,2}[/-]\d{1,2}[/-]-?\d{1,4}\b/);
    if (!match) return null;
    const normalized = normalizeExtractedValue(match[0], 'date');
    return normalized ? { value: normalized, quality: 10 } : null;
  }
  if (kind === 'zip') {
    const match = value.match(/\b\d{5}(?:-\d{4})?\b/);
    return match ? { value: match[0], quality: 10 } : null;
  }
  if (kind === 'state') {
    const match = value.match(/^([A-Za-z]{2})(?:\b|$)/);
    return match ? { value: match[1].toUpperCase(), quality: 8 } : null;
  }
  if (kind === 'suffix') {
    const match = value.match(/^(Jr\.?|Sr\.?|II|III|IV|V)$/i);
    return match ? { value: match[1], quality: 8 } : null;
  }
  if (kind === 'name') {
    if (value.length > 60 || /\d|:|\b(?:name|address|phone|email|birth)\b/i.test(value)) return null;
    const match = value.match(/^[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*)*$/u);
    return match ? { value, quality: value.length <= 35 ? 8 : 3 } : null;
  }
  if (kind === 'city') {
    if (value.length > 60 || /\d|:/.test(value)) return null;
    return { value, quality: 5 };
  }
  if (kind === 'address') {
    if (value.length > 120 || /:$/.test(value)) return null;
    return { value, quality: /\d/.test(value) ? 7 : 3 };
  }
  return { value, quality: 0 };
}

function stripValueDecorations(value) {
  return String(value ?? '')
    .replace(/^[\s:;|#_–—-]+/, '')
    .replace(/[|_]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isStandaloneLabel(line, occurrence) {
  return stripValueDecorations(line.slice(0, occurrence.start)) === ''
    && stripValueDecorations(line.slice(occurrence.end)) === '';
}

function findDefinitionForFormField(fieldLabel) {
  const compactField = normalizeLabel(fieldLabel).replace(/\s/g, '');
  return [...DEFINITIONS]
    .sort((a, b) => longestLabel(b) - longestLabel(a))
    .find((definition) => [...definition.labels, ...(definition.formLabels ?? [])]
      .some((label) => compactField.includes(normalizeLabel(label).replace(/\s/g, ''))));
}

function longestLabel(definition) {
  return Math.max(...definition.labels.map((label) => label.length));
}

function cleanLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeLabel(value) {
  return String(value ?? '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function scoreToConfidence(score) {
  if (score >= 100) return 0.92;
  if (score >= 88) return 0.84;
  if (score >= 73) return 0.68;
  return 0.55;
}

function sourceNote(candidate) {
  if (candidate.fromOcr) return 'Recognized by local OCR; verify against the PDF image.';
  if (candidate.fromFormField) return 'Read from a completed PDF form field.';
  return '';
}

function setAtPath(object, path, value) {
  const keys = path.split('.');
  const finalKey = keys.pop();
  const target = keys.reduce((current, key) => current[key], object);
  target[finalKey] = value;
}

function deduplicate(items) {
  const bestByValue = new Map();
  for (const item of items) {
    const key = item.value.toLowerCase();
    if (!bestByValue.has(key) || bestByValue.get(key).score < item.score) bestByValue.set(key, item);
  }
  return [...bestByValue.values()];
}

export const phaseOneFields = DEFINITIONS.map(({ path }) => path);
