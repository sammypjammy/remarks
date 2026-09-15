# Release versions and notes

- For each substantive user-requested change prepared for commit/push, update the affected tool page's footer version and its on-page version history as part of the implementation.
- Increment that tool's minor version once per release-sized request (for example, Fax Sender v.2.2 -> v.2.3), unless the user specifies a version. Do not bump again for follow-up fixes within the same unreleased change.
- Use the page body's `data-footer-version` and `data-version-history` attributes to customize the shared footer. Keep unrelated tool versions unchanged.
- Add a dated version-history entry describing the actual change. Include the resulting version and a concise, copyable release note in the final response.
- These updates do not authorize committing or pushing. Only commit or push when explicitly requested.
