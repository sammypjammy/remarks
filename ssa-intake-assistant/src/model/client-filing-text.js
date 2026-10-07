// Presentation only: all values and occurrences come from the Checker-owned snapshot.
export function clientFilingText(data) {
  const scopes = new Map(data.scopes.map(scope => [scope.id, scope]));
  const path = scope => scope.parentId ? `${path(scopes.get(scope.parentId))} / ${scope.title}` : scope.title;
  const name = label => label.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    .map(word => word[0].toUpperCase() + word.slice(1)).join('');
  const line = (label, value) => `${name(label)}: ${String(value ?? '').replace(/\r?\n/g, '\n  ')}`;
  const groups = data.scopes.map(scope => {
    const fields = data.fields.filter(field => field.scopeId === scope.id);
    if (!fields.length) return null;
    return [`[${path(scope)}]`, ...fields.flatMap(field => {
      if (!field.occurrences.length) return [line(field.label, 'Not provided')];
      return field.occurrences.map((occurrence, index) => {
        const label = field.label + (field.occurrences.length > 1 ? ` ${index + 1}` : '');
        // Preserve invalid/ambiguous input for inspection instead of turning it into an answer.
        const value = field.valueStatus === 'value' ? occurrence.formattedValue : occurrence.currentValue;
        return line(label, String(value ?? '').trim() ? value : 'Not provided');
      });
    })].join('\n');
  }).filter(Boolean);
  if (data.unparsed.length) groups.push(['[UNMAPPED TEXT]', ...data.unparsed.map(item => line(`Line ${item.line}`, item.text))].join('\n'));
  return groups.join('\n\n');
}
