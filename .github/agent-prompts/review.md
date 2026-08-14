Review the current worktree diff against the attached issue JSON, acceptance criteria, declared touch-set, repository rules, and tests. Fix every concrete defect you find without expanding scope. Run focused checks for any fix.

Reject tests that are implementation-coupled (mock internal collaborators, test private methods), tautological (expected value derived the same way as the code), or horizontally sliced (all tests written before all implementation). Verify test-first was followed at the ticket's declared seams unless the change is purely mechanical.

Do not call GitHub, commit, push, create or edit issues, or open/merge a PR. Exit non-zero when the work cannot be made correct within scope.
