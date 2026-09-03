/*
 * Med Tabs page behavior migrated from the standalone generator.
 * Shared Toolkit navigation and theme behavior live in ../../shared/app-shell.js.
 */

const ui = {
  inputText: document.getElementById('inputText'),
  generateBtn: document.getElementById('generateBtn'),
  statusMessage: document.getElementById('statusMessage'),
  resultsContainer: document.getElementById('resultsContainer'),
  resultCount: document.getElementById('resultCount'),
  greenCount: document.getElementById('greenCount'),
  yellowCount: document.getElementById('yellowCount'),
  redCount: document.getElementById('redCount'),
  duplicateCount: document.getElementById('duplicateCount'),
  copyBlankTemplateBtn: document.getElementById('copyBlankTemplateBtn'),
  clearAllBtn: document.getElementById('clearAllBtn'),
  toastContainer: document.getElementById('toastContainer'),
  outputPanel: document.querySelector('.output-panel')
};

const BLANK_MED_TAB_TEMPLATE = [
  'NAME, ADDRESS, PHONE NUMBER, FAX NUMBER:',
  '',
  '',
  'DOCTORS:',
  '',
  '',
  'TREATMENT RANGE: (FV, LV, OR ONGOING)',
  'FV',
  'LV',
  'NV',
  '',
  'CS TREATMENT LOG:',
  '',
  'NOTES: (IMPORTANT TESTS, SURGERIES, HOSPITALIZATIONS)'
].join('\n');

const toastNotifications = {
  duration: 2500,

  show(message, variant = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${variant}`;
    toast.setAttribute('role', variant === 'error' ? 'alert' : 'status');
    toast.textContent = message;
    ui.toastContainer.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add('is-leaving');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }, this.duration);
  }
};

const providerValidator = {
  validate(provider) {
    const fields = provider.fields || {};
    const criticalMissing = [];
    const otherMissing = [];
    const hasClinicName = this.hasValue(fields.name);
    const hasDoctorName = this.hasValue(fields.doctor);
    const phoneStatus = this.validatePhone(fields.phone);

    if (phoneStatus === 'missing') {
      criticalMissing.push('Phone number');
    } else if (phoneStatus === 'invalid') {
      criticalMissing.push('Invalid phone number');
    }
    if (!hasClinicName && !hasDoctorName) {
      criticalMissing.push('Clinic name and doctor name');
    }

    const addressChecks = this.getAddressChecks(fields);
    if (!addressChecks.streetAddress) otherMissing.push('Street address');
    if (!addressChecks.city) otherMissing.push('City');
    if (!addressChecks.state) otherMissing.push('State');
    if (!addressChecks.zipcode) otherMissing.push('ZIP code');
    if (!this.hasValue(fields.fv) && !this.hasValue(fields.lv)) otherMissing.push('First or Last Visit Date');

    const missing = [...criticalMissing, ...otherMissing];
    const state = String(fields.state || '').trim().toUpperCase();
    const outOfState = /^[A-Z]{2}$/.test(state) && state !== 'TX';
    const validationLevel = criticalMissing.length
      ? 'critical'
      : otherMissing.length
        ? 'warning'
        : 'complete';
    const level = outOfState && validationLevel === 'complete' ? 'out-of-state' : validationLevel;
    const labels = {
      critical: 'Critical information missing',
      warning: 'Information missing',
      complete: 'Complete',
      'out-of-state': 'Out of State'
    };

    return {
      level,
      label: labels[level],
      outOfState,
      missing,
      summary: missing.length ? `Missing: ${missing.join(', ')}` : ''
    };
  },

  hasValue(value) {
    return Boolean(String(value || '').trim()) && !/^(?:not provided|n\/?a|none|\.)$/i.test(String(value).trim());
  },

  validatePhone(value) {
    const phone = String(value ?? '').trim();
    if (!phone) {
      return 'missing';
    }

    if (!/^[+\d\s().-]+$/.test(phone)) {
      return 'invalid';
    }

    if (phone.includes('+') && !/^\+1/.test(phone)) {
      return 'invalid';
    }

    let digits = phone.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) {
      digits = digits.slice(1);
    }

    return digits.length === 10 ? 'valid' : 'invalid';
  },

  getAddressChecks(fields) {
    const address = String(fields.address || '').trim();
    const hasStructuredParts = ['streetAddress', 'city', 'state', 'zipcode'].some((key) =>
      Object.prototype.hasOwnProperty.call(fields, key)
    );

    if (hasStructuredParts) {
      return {
        streetAddress: this.hasValue(fields.streetAddress),
        city: this.hasValue(fields.city),
        state: this.hasValue(fields.state),
        zipcode: this.hasValue(fields.zipcode)
      };
    }

    return {
      streetAddress: this.hasValue(address),
      city: /,\s*[^,]+,\s*[A-Z]{2}\b/i.test(address),
      state: /,\s*[A-Z]{2}\b/i.test(address),
      zipcode: /\b\d{5}(?:-\d{4})?\b/.test(address)
    };
  }
};

function normalizePhoneForDuplicateCheck(phone) {
  const value = String(phone ?? '').trim();
  if (!value || !/^(?:\+1)?[\d\s().-]+$/.test(value)) {
    return '';
  }

  const withoutCountryCode = value.replace(/^\+1\s*/, '');
  const digits = withoutCountryCode.replace(/[\s().-]/g, '');
  return /^\d{10}$/.test(digits) ? digits : '';
}

function normalizeAddressForDuplicateCheck(address) {
  const genericValues = new Set(['not provided', 'unknown', 'n/a', 'na', 'none']);
  const abbreviationMap = {
    street: 'st',
    st: 'st',
    road: 'rd',
    rd: 'rd',
    avenue: 'ave',
    ave: 'ave',
    boulevard: 'blvd',
    blvd: 'blvd',
    drive: 'dr',
    dr: 'dr',
    lane: 'ln',
    ln: 'ln',
    highway: 'hwy',
    hwy: 'hwy',
    suite: 'ste',
    ste: 'ste',
    north: 'n',
    n: 'n',
    south: 's',
    s: 's',
    east: 'e',
    e: 'e',
    west: 'w',
    w: 'w'
  };
  const rawAddress = String(address ?? '');
  const hasGenericComponent = rawAddress
    .toLowerCase()
    .split(',')
    .some((part) => genericValues.has(part.replace(/\./g, '').trim()));
  const normalized = rawAddress
    .toLowerCase()
    .trim()
    .replace(/[,.]/g, '')
    .replace(/\s+/g, ' ');

  if (!normalized || hasGenericComponent || genericValues.has(normalized)) {
    return '';
  }

  return normalized
    .split(' ')
    .map((part) => abbreviationMap[part] || part)
    .join(' ');
}

function findDuplicateGroups(providers) {
  const groupsByKey = new Map();

  providers.forEach((provider) => {
    const phone = normalizePhoneForDuplicateCheck(provider?.fields?.phone);
    const address = normalizeAddressForDuplicateCheck(provider?.fields?.address);
    if (!phone || !address) {
      return;
    }

    const key = `${phone}\u0000${address}`;
    const group = groupsByKey.get(key) || [];
    group.push(provider);
    groupsByKey.set(key, group);
  });

  return [...groupsByKey.values()].filter((group) => group.length > 1);
}

function markDuplicateGroups(providers) {
  providers.forEach((provider) => delete provider.duplicate);
  findDuplicateGroups(providers).forEach((group, groupIndex) => {
    const originalProviderId = group[0].id;
    group.forEach((provider, providerIndex) => {
      provider.duplicate = {
        groupId: groupIndex + 1,
        originalProviderId,
        isOriginal: providerIndex === 0
      };
    });
  });
  return providers;
}

const validationSummaryCounters = {
  summarize(providers) {
    return providers.reduce((summary, provider) => {
      const { level } = providerValidator.validate(provider);
      summary.providers += 1;
      if (level === 'complete') summary.complete += 1;
      if (level === 'warning') summary.warning += 1;
      if (level === 'critical') summary.critical += 1;
      if (provider.duplicate) summary.duplicates += 1;
      return summary;
    }, { providers: 0, complete: 0, warning: 0, critical: 0, duplicates: 0 });
  },

  update(providers) {
    const summary = this.summarize(providers);
    this.setCounter(ui.resultCount, summary.providers, summary.providers === 1 ? 'Provider' : 'Providers');
    this.setCounter(ui.greenCount, summary.complete, 'Green', true);
    this.setCounter(ui.yellowCount, summary.warning, 'Yellow', true);
    this.setCounter(ui.redCount, summary.critical, 'Red', true);
    this.setCounter(ui.duplicateCount, summary.duplicates, 'Duplicates', true);
    return summary;
  },

  setCounter(element, count, label, hideWhenZero = false) {
    if (!element) return;
    element.textContent = `${count} ${label}`;
    element.hidden = hideWhenZero && count === 0;
    element.dataset.count = String(count);
  }
};

const formatter = {
  formatProviderTab(provider) {
    return formatMedTab(provider.canonical || provider);
  },

  normalizeAddress(address) {
    if (!address) {
      return '';
    }

    return address
      .replace(/\s+/g, ' ')
      .replace(/,\s*/g, ', ')
      .trim();
  },

  normalizeVisitDate(date) {
    if (!date || /^(?:not provided|n\/?a|none)$/i.test(date.trim())) {
      return '';
    }

    const match = date.trim().match(/^(\d{1,2})\/\d{1,2}\/(\d{4})$/);
    return match ? `${match[1].padStart(2, '0')}/${match[2]}` : date.trim();
  }
};

const copiedProviderState = {
  providerIds: new Set(),

  has(providerId) {
    return this.providerIds.has(String(providerId));
  },

  mark(providerId) {
    this.providerIds.add(String(providerId));
  },

  reset() {
    this.providerIds.clear();
  }
};

const expandableProviderRow = {
  render(provider) {
    const formattedText = formatter.formatProviderTab(provider);
    const validation = providerValidator.validate(provider);
    const isCopied = copiedProviderState.has(provider.id);
    const statusLabels = {
      complete: 'Complete',
      warning: 'Yellow',
      critical: 'Red',
      'out-of-state': 'Out of State'
    };
    const displayTitle = validation.outOfState ? `${provider.title} - OUT OF STATE` : provider.title;
    const secondaryOutOfStateBadge = validation.outOfState && validation.level !== 'out-of-state'
      ? '<span class="status-badge status-badge-out-of-state">Out of State</span>'
      : '';
    const duplicateBadge = provider.duplicate
      ? '<span class="status-badge status-badge-duplicate">Duplicate</span>'
      : '';
    const duplicateReference = provider.duplicate && !provider.duplicate.isOriginal
      ? `<span class="duplicate-reference">Duplicate of Provider ${escapeHtml(provider.duplicate.originalProviderId)}</span>`
      : '';
    const duplicateDetails = provider.duplicate && !provider.duplicate.isOriginal
      ? `<div class="duplicate-details"><p>Possible duplicate of Provider ${escapeHtml(provider.duplicate.originalProviderId)}</p><p>Matching fields:</p><ul><li>Phone number</li><li>Address</li></ul></div>`
      : '';
    const rowId = `provider-${provider.id}`;
    const detailsId = `${rowId}-details`;
    const titleId = `${rowId}-title`;

    return `
      <article class="provider-card provider-row status-${validation.level}${isCopied ? ' is-copied' : ''}" data-id="${provider.id}" data-copied="${isCopied}">
        <div class="provider-summary">
          <button class="provider-toggle" type="button" aria-expanded="false" aria-controls="${detailsId}" data-action="toggle-provider">
            <span class="provider-chevron" aria-hidden="true">&#8250;</span>
            <span class="provider-copied-indicator" role="img" aria-label="Provider copied" title="Copied">&#10003;</span>
            <span id="${titleId}" class="provider-name" title="${escapeHtml(displayTitle)}">${escapeHtml(displayTitle)}</span>
            <span class="status-badge status-badge-${validation.level}">${statusLabels[validation.level]}</span>
            ${secondaryOutOfStateBadge}
            ${duplicateBadge}
            ${duplicateReference}
          </button>
          <button class="ghost-btn row-copy-btn" type="button" data-action="copy" aria-label="${isCopied ? 'Copy Med Tab again' : 'Copy Med Tab'} for ${escapeHtml(displayTitle)}">${isCopied ? 'Copied' : 'Copy'}</button>
        </div>
        <div id="${detailsId}" class="provider-details" role="region" aria-labelledby="${titleId}" hidden>
          ${duplicateDetails}
          ${validation.summary ? `<p class="missing-summary">${escapeHtml(validation.summary)}</p>` : ''}
          <pre class="medtab-output">${escapeHtml(formattedText)}</pre>
        </div>
      </article>
    `;
  },

  toggle(summaryRow) {
    const card = summaryRow.closest('.provider-row');
    const details = card?.querySelector('.provider-details');
    if (!card || !details) {
      return;
    }

    const isExpanded = summaryRow.getAttribute('aria-expanded') === 'true';
    summaryRow.setAttribute('aria-expanded', String(!isExpanded));
    details.hidden = isExpanded;
    card.classList.toggle('is-expanded', !isExpanded);
  }
};

const uiActions = {
  setLoading(isLoading) {
    ui.generateBtn.disabled = isLoading;
    ui.generateBtn.innerHTML = isLoading
      ? '<span class="spinner"></span>Generating...'
      : 'Generate Med Tabs';

    ui.generateBtn.classList.toggle('is-loading', isLoading);
  },

  setStatus(message, variant = '') {
    ui.statusMessage.textContent = message;
    ui.statusMessage.className = `status-message ${variant}`.trim();
  },

  renderResults(providers, emptyMode = 'no-results') {
    validationSummaryCounters.update(providers);
    ui.clearAllBtn.disabled = providers.length === 0 && !ui.inputText.value;

    if (!providers.length) {
      const isReady = emptyMode === 'ready';
      ui.resultsContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M10 12h5M10 16h5"/></svg>
          </div>
          <div>
            <h3>${isReady ? 'Ready to generate' : 'No providers found'}</h3>
            <p>${isReady ? 'Your formatted provider tabs will appear here.' : 'Paste more detailed intake text and try again.'}</p>
          </div>
        </div>
      `;
      return;
    }

    const cards = providers.map((provider) => expandableProviderRow.render(provider));

    ui.resultsContainer.innerHTML = cards.join('');
  },

  clearAll() {
    copiedProviderState.reset();
    ui.inputText.value = '';
    uiActions.renderResults([], 'ready');
    uiActions.setStatus('Paste a provider intake block to begin.', '');
    ui.inputText.focus();
    toastNotifications.show('Everything cleared');
  },

  handleGenerate() {
    const rawText = ui.inputText.value.trim();

    if (!rawText) {
      uiActions.setStatus('Please paste intake text before generating.', 'error');
      toastNotifications.show('Generation failed: no input provided', 'error');
      return;
    }

    uiActions.setStatus('Analyzing intake text...', '');
    uiActions.setLoading(true);
    copiedProviderState.reset();

    window.setTimeout(() => {
      try {
        const detectedFormat = detectInputFormat(rawText);
        const providers = normalizeProviders(rawText, detectedFormat).map((canonical, index) => {
          const doctor = [canonical.doctorFirst, canonical.doctorLast].filter(Boolean).join(' ');
          const cityState = [canonical.city, canonical.state].filter(Boolean).join(', ');
          const locality = [cityState, canonical.zip].filter(Boolean).join(' ');
          const address = [canonical.address, locality].filter(Boolean).join(', ');
          const provider = {
            id: index + 1,
            title: canonical.clinicName || doctor || `Provider ${index + 1}`,
            specialty: 'Medical Provider',
            rawText: canonical.rawSource,
            notes: canonical.notes ? canonical.notes.split('\n') : [],
            canonical,
            fields: {
              name: canonical.clinicName,
              doctor,
              phone: canonical.phone,
              fax: canonical.fax,
              address,
              streetAddress: canonical.address,
              city: canonical.city,
              state: canonical.state,
              zipcode: canonical.zip,
              fv: canonical.firstVisitDate,
              lv: canonical.lastVisitDate,
              nv: canonical.nextVisitDate
            }
          };
          return { ...provider, formattedText: formatMedTab(canonical) };
        });

        markDuplicateGroups(providers);
        uiActions.renderResults(providers);
        uiActions.setStatus(providers.length ? `Generated ${providers.length} provider tab${providers.length > 1 ? 's' : ''}.` : 'No provider tabs were generated.', providers.length ? 'success' : '');
        toastNotifications.show(
          providers.length ? `Generated ${providers.length} provider${providers.length === 1 ? '' : 's'}` : 'No providers detected',
          providers.length ? 'success' : 'warning'
        );
        ui.outputPanel.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (error) {
        uiActions.setStatus('Provider generation failed. Please check the intake text and try again.', 'error');
        toastNotifications.show('Provider generation failed', 'error');
      } finally {
        uiActions.setLoading(false);
      }
    }, 600);
  }
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

ui.generateBtn.addEventListener('click', uiActions.handleGenerate);
ui.clearAllBtn.addEventListener('click', () => {
  const shouldConfirm = window.PackardSettings.getSetting('confirmBeforeClearingMedTabs');
  if (shouldConfirm && !window.confirm('Clear the current Med Tabs content?')) return;
  uiActions.clearAll();
});
ui.copyBlankTemplateBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(BLANK_MED_TAB_TEMPLATE);
    toastNotifications.show('Blank template copied');
  } catch (error) {
    toastNotifications.show('Blank template could not be copied', 'error');
  }
});
ui.inputText.addEventListener('input', () => {
  const hasCards = Boolean(ui.resultsContainer.querySelector('.provider-card'));
  ui.clearAllBtn.disabled = !ui.inputText.value && !hasCards;
});

ui.inputText.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    uiActions.handleGenerate();
  }
});

ui.resultsContainer.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');

  if (!button) {
    return;
  }

  const action = button.getAttribute('data-action');
  if (action === 'toggle-provider') {
    expandableProviderRow.toggle(button);
    return;
  }

  const card = button.closest('.provider-card');

  if (!card) {
    return;
  }

  if (action === 'copy') {
    const pre = card.querySelector('.medtab-output');
    const textToCopy = pre?.textContent || '';

    if (!textToCopy) {
      return;
    }

    try {
      await navigator.clipboard.writeText(textToCopy);
      copiedProviderState.mark(card.dataset.id);
      card.classList.add('is-copied');
      card.dataset.copied = 'true';
      button.textContent = 'Copied';
      const providerName = card.querySelector('.provider-name')?.textContent || 'provider';
      button.setAttribute('aria-label', `Copied Med Tab for ${providerName}`);
      toastNotifications.show('Copied to clipboard');
      window.setTimeout(() => {
        button.textContent = 'Copy';
        button.setAttribute('aria-label', `Copy Med Tab again for ${providerName}`);
      }, 1400);
    } catch (error) {
      uiActions.setStatus('Copy failed. Please copy manually.', 'error');
      toastNotifications.show('Copy failed', 'error');
    }
  }
});

uiActions.renderResults([], 'ready');
uiActions.setStatus('Paste a provider intake block to begin.', '');
