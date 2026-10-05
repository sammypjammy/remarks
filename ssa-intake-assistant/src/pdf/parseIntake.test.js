import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIntakePages } from './parseIntake.js';

test('extracts fake identity and contact values with source pages', () => {
  const profile = parseIntakePages([
    { pageNumber: 2, text: 'First Name: Jordan\nLast Name: Rivera\nPhone: (210) 555-0142' },
  ], 'fake.pdf');
  assert.equal(profile.personal.firstName.value, 'Jordan');
  assert.equal(profile.personal.firstName.sourcePage, 2);
  assert.equal(profile.contact.phone.value, '(210) 555-0142');
  assert.equal(profile.personal.firstName.status, 'needs_review');
});

test('treats missing markers and impossible dates as missing', () => {
  const profile = parseIntakePages([
    { pageNumber: 1, text: 'Middle Name: Not provided\nDate of Birth: 11/30/-0001' },
  ]);
  assert.equal(profile.personal.middleName.status, 'missing');
  assert.equal(profile.personal.dateOfBirth.value, '');
});

test('flags conflicting extracted answers', () => {
  const profile = parseIntakePages([
    { pageNumber: 1, text: 'Email: one@example.test' },
    { pageNumber: 3, text: 'Email Address: two@example.test' },
  ]);
  assert.equal(profile.contact.email.status, 'conflict');
  assert.match(profile.contact.email.notes, /example\.test/);
});

test('extracts a value placed on the line after its label', () => {
  const profile = parseIntakePages([
    { pageNumber: 4, text: 'First Name\nJordan\nLast Name\nRivera' },
  ]);
  assert.equal(profile.personal.firstName.value, 'Jordan');
  assert.equal(profile.personal.lastName.value, 'Rivera');
  assert.equal(profile.personal.firstName.sourcePage, 4);
});

test('extracts values from named PDF form fields', () => {
  const profile = parseIntakePages(
    [{ pageNumber: 1, text: '' }],
    'fake-form.pdf',
    [
      { label: 'ApplicantFirstName', value: 'Jordan', pageNumber: 1 },
      { label: 'Mailing_Address', value: '123 Example Avenue', pageNumber: 2 },
    ],
  );
  assert.equal(profile.personal.firstName.value, 'Jordan');
  assert.ok(profile.personal.firstName.confidence >= 0.9);
  assert.equal(profile.contact.mailingAddress.street1.value, '123 Example Avenue');
});

test('marks OCR-derived answers with lower confidence', () => {
  const profile = parseIntakePages([
    { pageNumber: 1, text: 'First Name Jordan', ocrUsed: true },
  ]);
  assert.equal(profile.personal.firstName.value, 'Jordan');
  assert.ok(profile.personal.firstName.confidence < 0.7);
  assert.equal(profile.personal.firstName.status, 'needs_review');
});

test('segments two Packard questions sharing one visual row', () => {
  const profile = parseIntakePages([
    {
      pageNumber: 1,
      text: [
        'First Name: Jordan Middle Name: Avery',
        'Last Name: Rivera Suffix: Not provided',
        'Social Security Number: 000-12-3456 Phone Number: (210) 555-0142',
      ].join('\n'),
    },
  ]);
  assert.equal(profile.personal.firstName.value, 'Jordan');
  assert.equal(profile.personal.middleName.value, 'Avery');
  assert.equal(profile.personal.lastName.value, 'Rivera');
  assert.equal(profile.personal.suffix.status, 'missing');
  assert.equal(profile.personal.ssn.value, '000-12-3456');
  assert.equal(profile.contact.phone.value, '(210) 555-0142');
});

test('rejects concatenated neighboring labels and extracts a valid email substring', () => {
  const profile = parseIntakePages([
    {
      pageNumber: 1,
      text: 'First Name: Not provided Middle Name: Not provided\nEmail: jordan@example.test Preferred Contact Method: Email',
    },
  ]);
  assert.equal(profile.personal.firstName.status, 'missing');
  assert.equal(profile.personal.middleName.status, 'missing');
  assert.equal(profile.contact.email.value, 'jordan@example.test');
});

test('does not confuse parent or birth names with the applicant name', () => {
  const profile = parseIntakePages([
    {
      pageNumber: 2,
      text: 'Mother - First Name: Elena Mother - Maiden Name: Cruz\nFirst name at birth: Jordan',
    },
  ]);
  assert.equal(profile.personal.firstName.status, 'missing');
});
