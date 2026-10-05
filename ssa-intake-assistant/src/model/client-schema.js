export const FIELD_STATUSES = Object.freeze([
  'confirmed',
  'needs_review',
  'missing',
  'conflict',
  'firm_standard',
]);

export function createField(value = '', overrides = {}) {
  return {
    value,
    status: value === '' || value == null ? 'missing' : 'needs_review',
    sourcePage: null,
    confidence: value === '' || value == null ? 0 : 0.5,
    employeeConfirmed: false,
    notes: '',
    ...overrides,
  };
}

export function createClientProfile() {
  return {
    schemaVersion: 1,
    ready: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: { fileName: '', pageCount: 0 },
    personal: {
      firstName: createField(),
      middleName: createField(),
      lastName: createField(),
      suffix: createField(),
      preferredName: createField(),
      ssn: createField(),
      dateOfBirth: createField(),
      sex: createField(),
      citizenship: createField(),
    },
    contact: {
      phone: createField(),
      alternatePhone: createField(),
      email: createField(),
      mailingAddress: {
        street1: createField(),
        street2: createField(),
        city: createField(),
        state: createField(),
        zip: createField(),
      },
      physicalAddress: {
        street1: createField(),
        street2: createField(),
        city: createField(),
        state: createField(),
        zip: createField(),
      },
    },
    language: {
      speaksEnglish: createField(),
      readsEnglish: createField(),
      preferredLanguage: createField(),
      interpreterNeeded: createField(),
    },
    disability: {
      allegedOnsetDate: createField(),
      stoppedWorkingDate: createField(),
      priorApplications: [],
    },
    financial: {},
    conditions: [],
    providers: [],
    hospitals: [],
    medications: [],
    tests: [],
    jobs: [],
    marriages: [],
    children: [],
    education: {},
    emergencyContact: {},
    workersCompensation: {},
    specialWork: {},
    remarks: createField(),
  };
}

export function isField(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      Object.prototype.hasOwnProperty.call(value, 'value') &&
      Object.prototype.hasOwnProperty.call(value, 'status'),
  );
}
