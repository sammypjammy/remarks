// Intentionally fictional, fixed data. No import, paste, upload or messaging channel.
export function syntheticProfile() {
  const values = [
    ['personal.first-name', 'Synthetic', 'text'],
    ['personal.last-name', 'Example', 'text'],
    ['personal.middle-name', null, 'text'],
    ['personal.phone-number', '202-555-0142', 'text'],
    ['personal.email', 'synthetic@example.invalid', 'text'],
    ['birth.date-of-birth', '2000-01-02', 'date', 'day'],
    ['birth.city-of-birth', 'Example City', 'text'],
    ['birth.state-of-birth', 'Example State', 'text'],
    ['birth.country-of-birth', 'Example Country', 'text'],
    ['address.mailing-address-street-address', '123 Fictional Lane', 'text'],
    ['address.mailing-address-city', 'Sample City', 'text'],
    ['address.mailing-address-state', 'EX', 'text'],
    ['address.mailing-address-zipcode', '00000', 'text'],
    ['disability.onset-date-of-disability', '2020-03', 'date', 'month'],
    ['employment.when-did-you-last-work', '2020-02', 'date', 'month'],
  ];
  return { schema: 'packard.intake-client-profile', schemaVersion: '3.0.0', fields: values.map(([id, value, dataType, precision = null]) => ({ id, definitionId: id, recordId: null, value, dataType, precision, readiness: value === null ? 'blocked' : 'ready', blockingReasons: value === null ? [{ code: 'missing' }] : [] })) };
}
