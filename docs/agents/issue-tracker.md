# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`
- **Read an issue**: `gh issue view <number> --comments`
- **List issues**: use `gh issue list` with suitable state and label filters.
- **Comment**: `gh issue comment <number> --body "..."`
- **Apply/remove labels**: use `gh issue edit`.
- **Close**: `gh issue close <number> --comment "..."`

Infer the repository from `git remote -v`. The `gh` CLI does this automatically inside the clone.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub Issues are the canonical issue and PRD tracker. When a skill says "publish to the issue tracker," create a GitHub issue. When it says "fetch the relevant ticket," retrieve the corresponding GitHub issue and its comments.
