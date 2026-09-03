(function exposeMedTabParser(globalScope) {
  'use strict';

  const EMPTY_PROVIDER = Object.freeze({
    clinicName: '',
    doctorFirst: '',
    doctorLast: '',
    phone: '',
    fax: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    firstVisitDate: '',
    lastVisitDate: '',
    nextVisitDate: '',
    notes: '',
    rawSource: ''
  });

  // Conservative USPS 3-digit ZIP prefix ranges. Unassigned and ambiguous prefixes return blank.
  const ZIP_PREFIX_RANGES = Object.freeze([
    [6, 7, 'PR'], [8, 8, 'VI'], [9, 9, 'PR'], [10, 27, 'MA'], [28, 29, 'RI'],
    [30, 38, 'NH'], [39, 49, 'ME'], [50, 54, 'VT'], [55, 55, 'MA'], [56, 59, 'VT'],
    [60, 62, 'CT'], [63, 69, 'CT'], [70, 89, 'NJ'], [90, 98, 'AE'], [100, 149, 'NY'],
    [150, 196, 'PA'], [197, 199, 'DE'], [200, 200, 'DC'], [201, 201, 'VA'],
    [202, 205, 'DC'], [206, 219, 'MD'], [220, 246, 'VA'], [247, 268, 'WV'],
    [270, 289, 'NC'], [290, 299, 'SC'], [300, 319, 'GA'], [320, 349, 'FL'],
    [340, 340, 'AA'], [350, 369, 'AL'], [370, 385, 'TN'], [386, 397, 'MS'],
    [398, 399, 'GA'], [400, 427, 'KY'], [430, 459, 'OH'], [460, 479, 'IN'],
    [480, 499, 'MI'], [500, 528, 'IA'], [530, 549, 'WI'], [550, 567, 'MN'],
    [569, 569, 'DC'], [570, 577, 'SD'], [580, 588, 'ND'], [590, 599, 'MT'],
    [600, 629, 'IL'], [630, 658, 'MO'], [660, 679, 'KS'], [680, 693, 'NE'],
    [700, 714, 'LA'], [716, 729, 'AR'], [730, 732, 'OK'], [733, 733, 'TX'],
    [734, 749, 'OK'], [750, 799, 'TX'], [800, 816, 'CO'], [820, 831, 'WY'],
    [832, 838, 'ID'], [840, 847, 'UT'], [850, 865, 'AZ'], [870, 884, 'NM'],
    [885, 885, 'TX'], [889, 898, 'NV'], [900, 961, 'CA'], [962, 966, 'AP'],
    [967, 968, 'HI'], [970, 979, 'OR'], [980, 994, 'WA'], [995, 999, 'AK']
  ]);
  const ZIP_EXCEPTIONS = Object.freeze({
    '00501': 'NY', '00544': 'NY', '06390': 'NY', '96799': 'AS'
  });
  const UNASSIGNED_ZIP_PREFIXES = new Set([213, 517, 518, 519, 839, 848, 849]);
  const STATE_NAME_TO_ABBR = Object.freeze(Object.fromEntries([
    ['Alabama', 'AL'], ['Alaska', 'AK'], ['Arizona', 'AZ'], ['Arkansas', 'AR'], ['California', 'CA'],
    ['Colorado', 'CO'], ['Connecticut', 'CT'], ['Delaware', 'DE'], ['District of Columbia', 'DC'],
    ['Florida', 'FL'], ['Georgia', 'GA'], ['Hawaii', 'HI'], ['Idaho', 'ID'], ['Illinois', 'IL'],
    ['Indiana', 'IN'], ['Iowa', 'IA'], ['Kansas', 'KS'], ['Kentucky', 'KY'], ['Louisiana', 'LA'],
    ['Maine', 'ME'], ['Maryland', 'MD'], ['Massachusetts', 'MA'], ['Michigan', 'MI'], ['Minnesota', 'MN'],
    ['Mississippi', 'MS'], ['Missouri', 'MO'], ['Montana', 'MT'], ['Nebraska', 'NE'], ['Nevada', 'NV'],
    ['New Hampshire', 'NH'], ['New Jersey', 'NJ'], ['New Mexico', 'NM'], ['New York', 'NY'],
    ['North Carolina', 'NC'], ['North Dakota', 'ND'], ['Ohio', 'OH'], ['Oklahoma', 'OK'], ['Oregon', 'OR'],
    ['Pennsylvania', 'PA'], ['Rhode Island', 'RI'], ['South Carolina', 'SC'], ['South Dakota', 'SD'],
    ['Tennessee', 'TN'], ['Texas', 'TX'], ['Utah', 'UT'], ['Vermont', 'VT'], ['Virginia', 'VA'],
    ['Washington', 'WA'], ['West Virginia', 'WV'], ['Wisconsin', 'WI'], ['Wyoming', 'WY']
  ].map(([name, abbreviation]) => [name.toLowerCase(), abbreviation])));

  function lookupStateByZip(zip) {
    const match = String(zip || '').trim().match(/^(\d{5})(?:-\d{4})?$/);
    if (!match) return '';
    const fiveDigitZip = match[1];
    if (ZIP_EXCEPTIONS[fiveDigitZip]) return ZIP_EXCEPTIONS[fiveDigitZip];
    const prefix = Number(fiveDigitZip.slice(0, 3));
    if (UNASSIGNED_ZIP_PREFIXES.has(prefix)) return '';
    const range = ZIP_PREFIX_RANGES.find(([start, end]) => prefix >= start && prefix <= end);
    return range?.[2] || '';
  }

  function normalizeState(value) {
    const cleaned = String(value || '').trim();
    if (/^[A-Za-z]{2}$/.test(cleaned)) return cleaned.toUpperCase();
    return STATE_NAME_TO_ABBR[cleaned.toLowerCase()] || '';
  }

  const FIELD_ALIASES = Object.freeze({
    clinicName: [
      'Provider Organization', 'Medical Provider', 'Name of Clinic', 'Facility Name',
      'Practice Name', 'Clinic Name', 'Facility'
    ],
    doctorFirst: ['First Name of Provider', 'Doctor First Name', 'Provider First Name', 'Physician First Name'],
    doctorLast: ['Last Name of Provider', 'Doctor Last Name', 'Provider Last Name', 'Physician Last Name'],
    doctorFull: ['Treating Provider', 'Doctor Name', 'Physician Name', 'Provider Name', 'Doctor', 'Provider', 'Physician'],
    phone: ['Provider Phone', 'Phone Number', 'Clinic Phone', 'Office Phone', 'Telephone', 'Phone'],
    fax: ['Fax Number', 'Clinic Fax', 'Office Fax', 'Fax'],
    address: ['Clinic Street Address', 'Street Address', 'Clinic Address', 'Address Line 1', 'Address 1', 'Address'],
    city: ['City'],
    state: ['State'],
    zip: ['State Zip Code', 'Postal Code', 'Zipcode', 'ZIP', 'Zip'],
    firstVisitDate: ['Approximate Date of First Visit', 'First Visit Date', 'Date First Seen', 'Initial Visit', 'First Visit', 'FV'],
    lastVisitDate: ['Approximate Date of Last Visit', 'Last Visit Date', 'Date Last Seen', 'Most Recent Visit', 'Last Visit', 'LV'],
    nextVisitDate: ['Next Appointment', 'Next Visit Date', 'Follow-Up Date', 'Upcoming Visit', 'Next Visit', 'NV'],
    notes: ['Conditions treated', 'Condition Treated', 'Additional Notes', 'Medical Notes', 'Treatment Notes', 'Comments', 'Notes']
  });

  const ALIAS_ENTRIES = Object.entries(FIELD_ALIASES)
    .flatMap(([field, aliases]) => aliases.map((alias) => ({ field, alias })))
    .sort((a, b) => b.alias.length - a.alias.length);
  const ALIAS_PATTERN = ALIAS_ENTRIES.map(({ alias }) => escapeRegExp(alias)).join('|');
  const ALIAS_TO_FIELD = new Map(ALIAS_ENTRIES.map(({ field, alias }) => [alias.toLowerCase(), field]));
  const VALUE_MARKER = new RegExp(`(?:^|\\s)(${ALIAS_PATTERN})\\s*(?::|=|\\s[-\\u2013\\u2014]\\s)\\s*`, 'gi');
  const LABEL_ONLY = new RegExp(`^(${ALIAS_PATTERN})\\s*:?$`, 'i');
  const LABEL_WITH_SPACE_VALUE = new RegExp(`^(${ALIAS_PATTERN})\\s+(.+)$`, 'i');
  const BARE_ALIAS = new RegExp(`^\\s*(${ALIAS_PATTERN})\\s*\\*?`, 'i');

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function cleanLine(line) {
    return String(line || '')
      .replace(/\*\*/g, '')
      .replace(/^[\s*\-\u2022\u25aa\u25e6]+/, '')
      .trim();
  }

  function isMissingValue(value) {
    return /^(?:n\/?a|none|not provided|unknown|\.|-)?$/i.test(String(value || '').trim());
  }

  function fieldForAlias(alias) {
    return ALIAS_TO_FIELD.get(String(alias || '').toLowerCase()) || null;
  }

  function extractLabeledValues(line) {
    const cleaned = cleanLine(line);
    const matches = [...cleaned.matchAll(VALUE_MARKER)];

    if (matches.length) {
      return matches.map((match, index) => ({
        field: fieldForAlias(match[1]),
        alias: match[1],
        value: cleaned.slice(match.index + match[0].length, matches[index + 1]?.index ?? cleaned.length).trim()
      }));
    }

    const labelOnly = cleaned.match(LABEL_ONLY);
    if (labelOnly) {
      return [{ field: fieldForAlias(labelOnly[1]), alias: labelOnly[1], value: '' }];
    }

    const bareLabels = [];
    let remainder = cleaned;
    while (remainder) {
      const bareMatch = remainder.match(BARE_ALIAS);
      if (!bareMatch) break;
      bareLabels.push({ field: fieldForAlias(bareMatch[1]), alias: bareMatch[1], value: '' });
      remainder = remainder.slice(bareMatch[0].length);
    }
    if (bareLabels.length && !remainder.trim()) return bareLabels;

    const spacedValue = cleaned.match(LABEL_WITH_SPACE_VALUE);
    if (spacedValue) {
      return [{ field: fieldForAlias(spacedValue[1]), alias: spacedValue[1], value: spacedValue[2].trim() }];
    }

    return [];
  }

  function detectInputFormat(rawText) {
    const text = String(rawText || '').replace(/\r\n?/g, '\n');
    if (!text.trim()) return 'unknown';

    if (/^\s*clinic\s+name\s*#\s*\d+/im.test(text) ||
        /\bfirst visit\s*\(month\)|\bcondition treated\b/i.test(text)) {
      return 'child';
    }

    if (/^\s*medical\s+provider\s*#\s*\d+/im.test(text) ||
        /\b(?:first name of provider|approximate date of first visit|conditions treated)\b/i.test(text)) {
      return 'lobbie';
    }

    if (/^\s*clinic\s*(?:#\s*)?\d+\s*[:\-\u2013\u2014]?\s*$/im.test(text) ||
        /^\s*medical providers\s*$/im.test(text)) {
      return 'delorian';
    }

    const recognizedLabels = text.split('\n').reduce(
      (count, line) => count + extractLabeledValues(line).length,
      0
    );
    return recognizedLabels >= 2 ? 'label-value-generic' : 'unknown';
  }

  function isProviderHeading(line) {
    return /^(?:(?:medical\s+)?provider|clinic(?:\s+name)?|practice)\s*(?:#\s*)?\d+\s*[:\-\u2013\u2014]?$/i.test(cleanLine(line));
  }

  function isPageMarker(line) {
    const cleaned = cleanLine(line);
    return /^page\s+\d+(?:\s+of\s+\d+)?$/i.test(cleaned) ||
      /^[-_=]*\s*page\s+break\s*[-_=]*$/i.test(cleaned);
  }

  function blockHasProviderData(lines) {
    return lines.some((line) => extractLabeledValues(line).some(({ field }) => field));
  }

  function preprocessInput(rawText, detectedFormat) {
    void detectedFormat;
    return String(rawText || '').replace(/\r\n?/g, '\n');
  }

  function isAdditionalProviderHeading(line) {
    return /^Please provide information for any additional Medical Providers below:?$/i.test(cleanLine(line));
  }

  function splitProviderBlocks(rawText, detectedFormat) {
    const normalized = preprocessInput(rawText, detectedFormat).replace(/\f/g, '\nPAGE BREAK\n');
    const lines = normalized.split('\n');
    const blocks = [];
    let current = [];
    let seenFields = new Set();
    let boundaryPending = false;

    const pushCurrent = () => {
      const source = current.join('\n').trim();
      if (source && blockHasProviderData(current)) blocks.push(source);
      current = [];
      seenFields = new Set();
      boundaryPending = false;
    };

    lines.forEach((originalLine) => {
      const line = originalLine.trim();
      if (!line) {
        if (current.length) boundaryPending = true;
        current.push(originalLine);
        return;
      }

      if (isProviderHeading(line) || isAdditionalProviderHeading(line)) {
        pushCurrent();
        current.push(originalLine);
        return;
      }

      if (isPageMarker(line)) {
        if (current.length) boundaryPending = true;
        return;
      }

      const labeledValues = extractLabeledValues(line);
      const beginsIdentity = labeledValues.find(({ field }) => field === 'clinicName' || field === 'doctorFull');
      const repeatedClinic = beginsIdentity?.field === 'clinicName' && seenFields.has('clinicName') && seenFields.size >= 2;
      const repeatedDoctorBlock = beginsIdentity?.field === 'doctorFull' && boundaryPending &&
        seenFields.has('doctorFull') && seenFields.size >= 2;
      const repeatedIdentity = repeatedClinic || repeatedDoctorBlock;
      if (repeatedIdentity) pushCurrent();

      current.push(originalLine);
      labeledValues.forEach(({ field }) => {
        if (field) seenFields.add(field);
      });
      boundaryPending = false;
    });

    pushCurrent();
    return blocks;
  }

  function normalizePhone(value) {
    const original = String(value || '').trim();
    if (!original) return '';
    let digits = original.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
    return digits.length === 10
      ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
      : original;
  }

  function normalizeDate(value) {
    const original = String(value || '').trim();
    if (isMissingValue(original)) return '';
    if (/^ongoing$/i.test(original)) return 'Ongoing';
    if (/^\d{4}$/.test(original)) return original;

    let match = original.match(/^(\d{1,2})[\/\-.](?:\d{1,2}[\/\-.])?(\d{4})$/);
    if (match) return `${match[1].padStart(2, '0')}/${match[2]}`;

    match = original.match(/^(\d{4})[\/\-.](\d{1,2})(?:[\/\-.]\d{1,2})?$/);
    if (match) return `${match[2].padStart(2, '0')}/${match[1]}`;

    match = original.match(/^(\d{1,2})[\/\-.](\d{1,2})\s+(\d{4})$/);
    if (match) return `${match[1].padStart(2, '0')}/${match[3]}`;

    match = original.match(/^(\d{1,2})[\/\-.](\d{2})$/);
    if (match) return `${match[1].padStart(2, '0')}/20${match[2]}`;

    const monthNames = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
    };
    match = original.match(/^([A-Za-z]+)(?:\s+\d{1,2},?)?\s+(\d{4})$/);
    const month = match && monthNames[match[1].slice(0, 3).toLowerCase()];
    return month ? `${month}/${match[2]}` : '';
  }

  function splitDoctorName(value) {
    const cleaned = String(value || '')
      .replace(/^(?:dr\.?|doctor|physician)\s+/i, '')
      .replace(/,?\s+(?:md|m\.d\.|do|d\.o\.)$/i, '')
      .trim();
    if (!cleaned) return { first: '', last: '' };

    if (cleaned.includes(',')) {
      const [last, first] = cleaned.split(',').map((part) => part.trim());
      return { first: first || '', last: last || '' };
    }

    const parts = cleaned.split(/\s+/);
    if (parts.length === 1) return { first: parts[0], last: '' };
    return { first: parts.shift(), last: parts.join(' ') };
  }

  function parseCombinedAddress(provider) {
    const combined = provider.address.match(/^(.*?),\s*([^,]+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (!combined) return;
    provider.address = combined[1].trim();
    if (!provider.city) provider.city = combined[2].trim();
    if (!provider.state) provider.state = combined[3].toUpperCase();
    if (!provider.zip) provider.zip = combined[4];
  }

  function isNoiseLine(line) {
    return /^(?:https?:\/\/|page\s+\d+|\d+\/\d+\/\d+.*intake form|medical providers$|address 2\s*:|please provide|if you don'?t have|texas\s*\(tx\)$)/i.test(line);
  }

  function assignDoctor(provider, value) {
    const doctor = splitDoctorName(value);
    if (!provider.doctorFirst) provider.doctorFirst = doctor.first;
    if (!provider.doctorLast) provider.doctorLast = doctor.last;
  }

  function appendContinuation(provider, field, value) {
    const separator = field === 'phone' || field === 'fax' ? '' : ' ';
    provider[field] = `${provider[field] || ''}${separator}${value}`.replace(/\s+/g, ' ').trim();
  }

  function parseProviderBlock(rawSource, detectedFormat) {
    const provider = { ...EMPTY_PROVIDER, rawSource: rawSource.trim() };
    let pendingField = null;
    let collectingNotes = false;
    let continuationField = null;

    rawSource.split('\n').forEach((sourceLine) => {
      const line = cleanLine(sourceLine);
      if (!line || isPageMarker(line)) return;
      if (isProviderHeading(line)) {
        if (detectedFormat === 'child' && /^clinic\s+name\s*#/i.test(line)) pendingField = 'clinicName';
        return;
      }
      if (isAdditionalProviderHeading(line)) return;

      if (detectedFormat === 'lobbie') {
        const additional = line.match(/^(.*?)\s+Address:\s*(.*?)\s+Phone:\s*(.*?)(\d{1,2}\/\d{4})\s*-\s*(Ongoing)?\s*(.*)$/i);
        if (additional) {
          provider.clinicName = additional[1].trim();
          provider.address = additional[2].trim();
          provider.phone = additional[3].trim();
          provider.firstVisitDate = additional[4];
          provider.lastVisitDate = additional[5] || '';
          provider.notes = additional[6].trim();
          return;
        }
      }
      const entries = extractLabeledValues(line);

      if (!entries.length) {
        if (isNoiseLine(line)) return;
        if (pendingField === 'doctorFull' && !isMissingValue(line)) assignDoctor(provider, line);
        else if (pendingField && !isMissingValue(line)) {
          provider[pendingField] = line;
          continuationField = ['clinicName', 'address', 'phone', 'fax'].includes(pendingField) ? pendingField : null;
        } else if (collectingNotes) provider.notes = [provider.notes, line].filter(Boolean).join('\n');
        else if (continuationField && !isMissingValue(line)) appendContinuation(provider, continuationField, line);
        pendingField = null;
        return;
      }

      pendingField = null;
      collectingNotes = false;
      continuationField = null;
      entries.forEach(({ field, value }) => {
        if (!field) return;
        if (!value) {
          pendingField = field === 'doctorFull' ? 'doctorFull' : field;
          collectingNotes = field === 'notes';
          return;
        }
        if (isMissingValue(value)) return;

        if (field === 'doctorFull') {
          assignDoctor(provider, value);
        } else if (field === 'notes') {
          provider.notes = [provider.notes, value].filter(Boolean).join('\n');
          collectingNotes = true;
        } else if (!provider[field]) {
          provider[field] = value.trim();
        }
        if (['clinicName', 'address', 'phone', 'fax'].includes(field)) continuationField = field;
      });

    });

    provider.phone = normalizePhone(provider.phone);
    provider.fax = normalizePhone(provider.fax);
    provider.firstVisitDate = normalizeDate(provider.firstVisitDate);
    provider.lastVisitDate = normalizeDate(provider.lastVisitDate);
    provider.nextVisitDate = normalizeDate(provider.nextVisitDate);
    provider.state = normalizeState(provider.state);
    parseCombinedAddress(provider);

    if (detectedFormat === 'child') {
      const childDate = (visitType) => {
        const match = rawSource.match(new RegExp(
          `${visitType} Visit\\s*\\(month\\)\\s*\\n\\s*([^\\n]+?)\\s*\\n\\s*Year\\s*\\n\\s*([^\\n]+)`,
          'i'
        ));
        return match ? normalizeDate(`${match[1].trim()} ${match[2].trim()}`) : '';
      };
      provider.firstVisitDate = childDate('First') || provider.firstVisitDate;
      provider.lastVisitDate = childDate('Last') || provider.lastVisitDate;
    }

    if (!provider.firstVisitDate && provider.lastVisitDate) {
      provider.firstVisitDate = provider.lastVisitDate;
    }

    const clinicDoctor = provider.clinicName.match(/^(.*?)\s*\((?:DR\.?|DOCTOR)\s+(.+?)\)\s*$/i);
    if (clinicDoctor) {
      provider.clinicName = clinicDoctor[1].trim();
      if (!provider.doctorFirst && !provider.doctorLast) assignDoctor(provider, clinicDoctor[2]);
    }
    return provider;
  }

  function normalizeProviders(rawText, detectedFormat = detectInputFormat(rawText)) {
    if (!String(rawText || '').trim()) return [];
    const providers = splitProviderBlocks(rawText, detectedFormat)
      .map((source) => parseProviderBlock(source, detectedFormat))
      .filter((provider) => Object.keys(EMPTY_PROVIDER).some(
        (key) => key !== 'rawSource' && Boolean(provider[key])
      ));

    if (detectedFormat === 'child') {
      const displacedStates = [...String(rawText).matchAll(/^\s*[^\n()]+?\s*\(([A-Z]{2})\)\s*$/gim)]
        .map((match) => match[1].toUpperCase());
      providers.forEach((provider, index) => {
        if (!provider.state && displacedStates[index]) provider.state = displacedStates[index];
      });
    }

    providers.forEach((provider) => {
      if (!provider.state) provider.state = lookupStateByZip(provider.zip);
    });

    return providers;
  }

  function formatMedTab(provider) {
    const locality = [
      [provider.city, provider.state].filter(Boolean).join(', '),
      provider.zip
    ].filter(Boolean).join(' ');
    const address = [provider.address, locality].filter(Boolean).join(', ').replace(/\s+/g, ' ').trim();
    const doctor = [provider.doctorFirst, provider.doctorLast].filter(Boolean).join(' ');
    const details = [provider.clinicName, address, provider.phone, provider.fax].filter(Boolean);

    return [
      'NAME/ADDRESS/PHONE/FAX:',
      ...details,
      '',
      'DOCTORS',
      doctor,
      '',
      'TREATMENT RANGE',
      `FV:${provider.firstVisitDate ? ` ${provider.firstVisitDate}` : ''}`,
      `LV:${provider.lastVisitDate ? ` ${provider.lastVisitDate}` : ''}`,
      `NV:${provider.nextVisitDate ? ` ${provider.nextVisitDate}` : ''}`,
      '',
      'CS TREATMENT LOG',
      '',
      'NOTES',
      ''
    ].join('\n');
  }

  const api = { detectInputFormat, normalizeProviders, formatMedTab, lookupStateByZip };
  Object.assign(globalScope, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);

