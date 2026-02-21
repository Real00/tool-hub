---
name: tool-hub-release-workflow
description: Execute Tool Hub release workflow end-to-end for patch/minor versions. Use when user asks to release/publish/version bump (including 发版、发布小版本), summarize commits since the last tag, update package.json + CHANGELOG.md + README.md version markers, run pnpm typecheck/build, create release commit and git tag, and push tag to trigger GitHub Actions Windows release.
---

# Tool Hub Release Workflow

## Overview

Use this workflow to publish Tool Hub versions in a repeatable way.
Prefer tag-triggered CI release and keep the changelog aligned with the real commit range.

Repository conventions:
- Use `pnpm`.
- Avoid running dependency installation commands automatically.
- Treat `v*` tags as release triggers.

## Required Inputs

Collect these values before editing files:
- Target version: `X.Y.Z`
- Bump type: `patch` or `minor`
- Previous release tag: usually latest `v*`
- Release mode: tag-triggered CI

## Step 1: Collect Release Scope

Run from repo root:

```powershell
git status --short
git branch --show-current
git tag --list --sort=creatordate
git log --oneline --decorate --no-merges <last-tag>..HEAD
git diff --name-only <last-tag>..HEAD
```

Derive release notes from the actual range `<last-tag>..HEAD`, not only the last commit.

## Step 2: Update Versioned Files

Update these files together:
- `package.json`: set `"version": "X.Y.Z"`
- `CHANGELOG.md`: add/update section `## [X.Y.Z] - YYYY-MM-DD`
- `README.md`: sync displayed current version marker (for example `当前版本：X.Y.Z`)

Write changelog entries by grouped behavior:
- `Added`
- `Fixed`
- `Changed`

Keep entries scoped to commits in `<last-tag>..HEAD`.
Ensure `README.md` version text matches `package.json` before commit.

## Step 3: Run Quality Gates

Run:

```powershell
pnpm typecheck
pnpm build
```

Stop on failure and fix before commit.

## Step 4: Commit Release Changes

Stage only intended release files and source changes:

```powershell
git add <files>
git commit -m "chore(release): vX.Y.Z"
```

If release includes feature/fix commit(s) already made earlier, keep this commit focused on release metadata corrections only.

## Step 5: Tag and Push

Use tag-driven publish:

```powershell
git tag vX.Y.Z
git push origin <branch>
git push origin vX.Y.Z
```

For this repo, pushing `v*` triggers `.github/workflows/release-win.yml`.

## Step 6: Verify Publish Result

Confirm:
- GitHub Action `Release Windows` succeeds.
- GitHub Releases has expected artifacts.
- Tag `vX.Y.Z` points to intended commit.

Quick local checks:

```powershell
git show --no-patch --decorate --oneline vX.Y.Z
git log --oneline --decorate -5
```

## Step 7: Handle Post-Tag Changelog Fixes

If changelog needs correction after tag push:
- Prefer editing GitHub Release notes directly for the same tag.
- If repository files must change, commit the fix on `main`.
- Prefer publishing next patch (for example `vX.Y.(Z+1)`) instead of force-moving an existing tag.

## Repo-Specific Command Reference

- `pnpm typecheck`
- `pnpm build`
- `pnpm electron:pack:win`
- `pnpm electron:dist:win:dry`
- `pnpm electron:dist:win`

Release workflow file:
- `.github/workflows/release-win.yml`
