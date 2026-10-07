// Presentation only: employee dismissals never alter answers or readyFields().
export function reviewPresentation(profile) {
  const blocked = [], ignored = [];
  for (const field of profile.fields.filter(field => field.readiness === 'blocked')) {
    if (field.category === 'priorSpouses') continue;
    const unresolved = field.validation.issues.filter(issue => !issue.acknowledged);
    // Fillability is not a second employee review rulebook.
    if (!unresolved.length) {
      if (field.validation.issues.some(issue => issue.acknowledged)) ignored.push(field);
      continue;
    }
    const reasons = field.blockingReasons.filter(reason => {
      if (reason.code === 'validation') return unresolved.some(issue => issue.id === reason.issueId);
      return ['missing', 'conflict'].includes(reason.code) && unresolved.some(issue => issue.severity === 'error');
    });
    if (reasons.length) blocked.push({ ...field, blockingReasons: reasons });
  }
  return {
    blocked, ignored,
    parsingIssues: profile.validationIssues.filter(issue => issue.code === 'parsing' && !issue.acknowledged),
    requirements: profile.requirements.filter(issue => issue.code !== 'parsing' && !issue.acknowledged),
    reviews: profile.reviewDecisions.filter(item => !item.acknowledged),
  };
}
