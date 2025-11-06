# Releasing Guide

This document describes how to release new versions of `browser-automation-mcp-server` to npm.

## Prerequisites

Before you can publish releases, ensure:

1. You have maintainer access to the npm package
2. NPM_TOKEN is configured in GitHub repository secrets
3. You have write access to the GitHub repository

## Setting Up NPM_TOKEN

1. Log in to [npmjs.com](https://www.npmjs.com)
2. Go to Account Settings → Access Tokens
3. Click "Generate New Token" → "Automation"
4. Copy the token
5. Add it to GitHub repository secrets:
   - Go to repository Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `NPM_TOKEN`
   - Value: (paste your token)
   - Click "Add secret"

## CI/CD Overview

This project uses three GitHub Actions workflows:

### 1. CI Workflow (`.github/workflows/ci.yml`)

**Triggers**: Push to main/develop/feature branches, Pull Requests

**What it does**:

- Runs tests on Node.js 18, 20, and 22
- Performs type checking with TypeScript
- Runs linting (ESLint)
- Checks code formatting (Prettier)
- Generates code coverage reports
- Uploads coverage to Codecov
- Builds the package
- Runs security audit

**Status**: Required to pass before merging PRs

### 2. Release Workflow (`.github/workflows/release.yml`)

**Triggers**: When a version tag (v*.*.\*) is pushed

**What it does**:

- Validates the tag format (semver)
- Verifies package.json version matches the tag
- Runs full test suite and build
- Publishes to npm registry
- Creates a GitHub release with changelog
- Uploads package tarball as artifact

**Publishing Logic**:

- Stable versions (e.g., v1.2.3) → published with `latest` tag
- Pre-release versions (e.g., v1.2.3-beta.1) → published with `next` tag

### 3. Version Bump Workflow (`.github/workflows/version-bump.yml`)

**Triggers**: Manual workflow dispatch (GitHub Actions UI)

**What it does**:

- Automatically bumps the version in package.json
- Updates package-lock.json
- Generates changelog
- Commits the changes
- Creates and pushes a version tag
- Triggers the release workflow

## Release Methods

### Method 1: Automated Version Bump (Recommended)

1. Go to GitHub Actions → "Version Bump" workflow
2. Click "Run workflow"
3. Select version bump type:
   - **patch**: Bug fixes (1.0.0 → 1.0.1)
   - **minor**: New features (1.0.0 → 1.1.0)
   - **major**: Breaking changes (1.0.0 → 2.0.0)
   - **prepatch**: Pre-release patch (1.0.0 → 1.0.1-beta.0)
   - **preminor**: Pre-release minor (1.0.0 → 1.1.0-beta.0)
   - **premajor**: Pre-release major (1.0.0 → 2.0.0-beta.0)
   - **prerelease**: Increment pre-release (1.0.1-beta.0 → 1.0.1-beta.1)
4. If pre-release, enter identifier (alpha, beta, rc)
5. Click "Run workflow"

The workflow will:

- Bump the version
- Update changelog
- Create and push the tag
- Trigger the release workflow automatically

### Method 2: Manual Version Bump

1. Ensure you're on the main branch and it's up to date:

   ```bash
   git checkout main
   git pull origin main
   ```

2. Bump the version using npm:

   ```bash
   # For patch version (1.0.0 → 1.0.1)
   npm version patch

   # For minor version (1.0.0 → 1.1.0)
   npm version minor

   # For major version (1.0.0 → 2.0.0)
   npm version major

   # For pre-release versions
   npm version prerelease --preid=beta
   npm version prepatch --preid=beta
   npm version preminor --preid=beta
   npm version premajor --preid=beta
   ```

   This will:
   - Update version in package.json
   - Create a git commit
   - Create a git tag

3. Push the commit and tag:

   ```bash
   git push origin main --tags
   ```

4. The release workflow will automatically trigger and publish to npm

## Monitoring Releases

### Check Workflow Status

1. Go to GitHub Actions tab
2. Find the "Release & Publish" workflow run
3. Monitor the progress of each job

### Verify npm Publication

After the release workflow completes:

1. Check npm package page: https://www.npmjs.com/package/browser-automation-mcp-server
2. Verify the new version is listed
3. Test installation:
   ```bash
   npm install browser-automation-mcp-server@latest
   ```

### Check GitHub Release

1. Go to the repository's Releases page
2. Verify the new release is created with:
   - Release notes (auto-generated changelog)
   - Package tarball attachment

## Release Checklist

Before releasing a new version:

- [ ] All CI checks are passing on main branch
- [ ] Update README if there are significant changes
- [ ] Review and merge all intended PRs
- [ ] Ensure CHANGELOG.md is up to date (if maintaining manually)
- [ ] Test the package locally:
  ```bash
  npm run build
  npm pack
  # Test the generated .tgz file in another project
  ```
- [ ] Review breaking changes (for major versions)
- [ ] Update migration guide (for breaking changes)

## Version Numbering Guide

Follow [Semantic Versioning (semver)](https://semver.org/):

### MAJOR version (X.0.0)

Increment when you make incompatible API changes:

- Removing or renaming tools
- Changing tool parameters in non-backward-compatible ways
- Removing features

### MINOR version (0.X.0)

Increment when you add functionality in a backward-compatible manner:

- Adding new tools
- Adding optional parameters to existing tools
- Adding new features

### PATCH version (0.0.X)

Increment when you make backward-compatible bug fixes:

- Bug fixes
- Performance improvements
- Documentation updates
- Internal refactoring

### Pre-release versions (0.0.0-beta.X)

Use for testing before official release:

- **alpha**: Early testing, may be unstable
- **beta**: Feature complete, testing for bugs
- **rc**: Release candidate, final testing

Examples:

- `1.0.0-alpha.1` → Early testing
- `1.0.0-beta.1` → Beta testing
- `1.0.0-rc.1` → Release candidate
- `1.0.0` → Stable release

## Rollback a Release

If you need to rollback a release:

### 1. Deprecate the bad version on npm

```bash
npm deprecate browser-automation-mcp-server@<version> "This version has critical bugs, please upgrade to <fixed-version>"
```

### 2. Release a new fixed version

- Don't delete or unpublish versions (npm policies discourage this)
- Instead, release a new patch version with the fix
- Update the deprecation message to point to the fixed version

### 3. Update GitHub Release

- Edit the GitHub release
- Add a warning about the issues
- Link to the fixed version

## Troubleshooting

### Release workflow fails with "403 Forbidden" on npm publish

- Check that NPM_TOKEN is correctly set in GitHub secrets
- Verify the token has publish permissions
- Ensure you have maintainer access to the package

### Version mismatch error

- Ensure package.json version matches the git tag
- Tag format must be `vX.Y.Z` (note the 'v' prefix)
- Package.json version must be `X.Y.Z` (no 'v' prefix)

### CI checks fail during release

- The release workflow requires all CI checks to pass
- Fix the issues and create a new tag with a bumped version
- Don't reuse the same tag after fixing issues

### Permission denied when pushing tags

- Ensure you have write access to the repository
- Check that branch protection rules allow tag creation
- Verify your git credentials are up to date

## Pre-release Testing

Before releasing a major version, consider:

1. **Create a pre-release version**:

   ```bash
   npm version prerelease --preid=beta
   git push origin main --tags
   ```

2. **Test in real projects**:

   ```bash
   npm install browser-automation-mcp-server@next
   ```

3. **Gather feedback** from users testing the pre-release

4. **Release stable version** when ready:
   ```bash
   npm version major  # Removes pre-release suffix
   git push origin main --tags
   ```

## Continuous Deployment

This project uses tag-based deployment:

- Tags starting with `v` trigger the release workflow
- The workflow automatically publishes to npm
- No manual npm publish commands needed
- All releases are auditable through GitHub Actions logs

## Support

For questions about the release process:

- Open an issue on GitHub
- Contact the maintainers
- Check GitHub Actions logs for error details

## Additional Resources

- [npm Publishing Guide](https://docs.npmjs.com/packages-and-modules/contributing-packages-to-the-registry)
- [Semantic Versioning](https://semver.org/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [npm Automation Tokens](https://docs.npmjs.com/creating-and-viewing-access-tokens)
