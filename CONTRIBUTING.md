# Contributing to opencode-browser-use

Contributions are welcome! Please follow these engineering guidelines:

## Core Principles

1. **Strict Typed Boundaries & No Defensive Bloat**:
   - Parse and validate data at trust boundaries.
   - Do not pass optional parameters through deep chains with repetitive `if/else` verifiers when types already guarantee invariants.
2. **Transparent, Fail-Fast Errors**:
   - Never use `try/catch` as routine control flow.
   - Do not swallow errors or fake success; let unexpected failures surface visibly.
3. **Zero Overengineering**:
   - Keep code minimal, clean, and intuitive.
4. **Verification**:
   - All contributions must compile cleanly with `npm run build`, pass `npm run lint`, and pass all tests via `npm test`.

## Development Workflow

```bash
# Install dependencies
npm install

# Run typecheck and build
npm run build

# Run linter
npm run lint

# Run test suite
npm test
```
