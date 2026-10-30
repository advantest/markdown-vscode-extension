# Custom instructions for this repository

Instructions for GitHub Copilot when working in `markdown-vscode-extension`. They apply to every
session in this repository, in addition to what a task asks for.

## Committing

- **One concern per commit.** A commit does one thing, and its message says that thing. If a change
  brings an unrelated fix along, that fix goes into its own commit — a reader looking for it later
  will not find it under a message that never mentions it.
- **Separate a file rename from a change of its content.** A rename goes into its own commit, with
  the file content untouched, so that git recognises it as a rename and every client shows it as
  one. The change of the content follows in the next commit.
- **Commit a rename on its own.** Renaming a type, a function, a setting or a command touches every
  place that uses it, so a rename mixed with other work buries that work in noise.
- **Say "rename" in the message of a rename commit**, and name the old and the new name.
- **Change dependencies in a commit of their own.** Adding, removing or upgrading a package changes
  `package.json` and `package-lock.json` together, and nothing else.
- **Split first, run the tests afterwards.** Where a change falls into several commits, the split is
  worth more than every single commit compiling; a commit in the middle of such a series is not
  expected to be green on its own.
- Write the commit message as a conventional commit (`feat:`, `fix:`, `test:`, `docs:`, …) and in
  whole sentences, saying what the commit achieves rather than which files it touches.
- Limit the first line of a commit message, its title, to 72 characters.

## Dependencies

- Use **npm**, and commit `package-lock.json`. Install with `npm ci` where the lock file is to be
  followed exactly, e.g. in a build.
- Do not run `npm audit fix --force`; it upgrades across major versions without asking.

## Markdown files

- Limit a line to 120 characters. A table is exempt where the syntax would otherwise break.
- Align the columns of a table with spaces so that it is readable in the source as well.

## Pushing

Pushing a commit is the repository owner's business alone. Commit what the task asks for and leave
the branch where it is: do not push it, do not open a pull request and do not ask to be allowed to.
Whoever owns the repository decides when work leaves this machine and under which name it arrives.

## This repository is open source

- **Do not depend on, name or bundle a closed-source component.**
- **Name only the repositories this one depends on.** The language server the extension starts may
  be named; the libraries behind it may not.
- **Keep names product-neutral.** Settings, commands, request names and identifiers do not carry the
  name of another product.
