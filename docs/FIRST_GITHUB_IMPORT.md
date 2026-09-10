# First GitHub Import

Run these commands from the repository root after creating the GitHub repository:

```bash
git init
git lfs install
git add .gitattributes
git add .
git status
```

Before committing, verify that the Game Server is tracked by LFS:

```bash
git lfs ls-files
```

Only after reviewing `git status` and confirming that no secret/runtime file is staged:

```bash
git commit -m "Initial production monorepo import"
git branch -M main
git remote add origin <GITHUB_REPOSITORY_URL>
git push -u origin main
```

Do not commit or push until the staged-file and secret checks are complete.
