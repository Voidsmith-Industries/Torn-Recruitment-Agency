# Contributing

Contributions are welcome through GitHub pull requests.

## Workflow

1. Fork the repository.
2. Create a focused branch from the current `main`.
3. Keep changes limited to one coherent concern.
4. Add or update tests for behavior changes.
5. Run the repository verification commands before opening a pull request.
6. Open a pull request against `main` and explain what changed, why, and how it was verified.

## Verification

Run:

```bash
npm install --no-audit --no-fund
npm test
npm run syntax
```

## Security and privacy

Do not commit API keys, cookies, tokens, personal data, private infrastructure details, or other secrets. Do not weaken fail-closed checks, manual-send boundaries, or existing safety behavior merely to make a test pass.

Security concerns should follow `SECURITY.md`, not a public issue.

## Generated/distribution files

Keep the bundled userscript consistent with the repository build and release process. Do not replace reviewed source with unrelated generated or minified code.
