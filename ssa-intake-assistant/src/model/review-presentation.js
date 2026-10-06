// Presentation only: employee dismissals never alter answers or readyFields().
export function reviewPresentation(profile) {
  const blocked = [], ignored = [];
  for (const field of profile.fields.filter(field => field.readiness === 'blocked')) {
    const acknowledged = field.validation.issues.filter(issue => issue.acknowledged);
    const reasons = field.blockingReasons.filter(reason => {
      if (reason.code === 'validation') return !acknowledged.some(issue => issue.id === reason.issueId);
      if (['missing', 'conflict'].includes(reason.code)) return !acknowledged.some(issue => issue.severity === 'error');
      return true;
    });
    if (reasons.length) blocked.push({ ...field, blockingReasons: reasons });
    else ignored.push(field);
  }
  return {
    blocked, ignored,
    parsingIssues: profile.validationIssues.filter(issue => issue.code === 'parsing' && !issue.acknowledged),
    requirements: profile.requirements.filter(issue => issue.code !== 'parsing' && !issue.acknowledged),
    reviews: profile.reviewDecisions.filter(item => !item.acknowledged),
  };
}
