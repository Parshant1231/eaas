# Incident log

## Problem: git push rejected (non-fast-forward)

### Date
2026-10-07

### Symptom
`git push origin main` was rejected. `git pull` also failed with
"no tracking information for the current branch".

### Error
```text
! [rejected] main -> main (non-fast-forward)
hint: Updates were rejected because the tip of your current branch is behind its remote counterpart.
```

### Investigation
Checked `git log --oneline --all --graph` and `git show --stat HEAD`. The local
commit "add readme, gitignore" had 0 insertions (both files empty), while the
real files only existed in the remote commit 13e70a0.

### Root cause
The local history had been re-created, so it no longer shared the remote's
history. The remote held the real .gitignore and README; local held empty
copies. Pushing would have been rejected, and force-pushing would have
overwritten the real files.

### Solution
Saved local work with `git branch backup-local`, ran
`git reset --hard origin/main`, restored only the Jenkins compose file with
`git checkout backup-local -- jenkins/docker-compose.yml`, committed, and
pushed with `-u`.

### Verification
`git log --oneline` shows a linear history. `git status -sb` shows
`main...origin/main` with no ahead/behind. GitHub shows all files.

### Lesson learned
Read the error and compare histories before pushing. A rejected push is
protection, not a nuisance: `--force` would have destroyed the good version.
Create a backup branch before any destructive reset.
