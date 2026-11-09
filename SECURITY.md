# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Security Architecture & Practices

`opencode-browser-use` adheres to strict security controls:

- **Strict Subprocess Containment**: Browser runner processes are invoked with explicit argument arrays, preventing shell interpolation and injection vulnerabilities.
- **Keychain Secret Storage**: Authentication credentials are stored securely via the macOS Keychain (`/usr/bin/security`) and never written to plaintext log files or configuration repositories.
- **Permission Enforcement**: Tool calls require explicit session permission validation via `ctx.permission.assert` before executing actions.
- **Automated Analysis**: CodeQL static analysis and dependency audits run continuously via GitHub Actions.

## Reporting a Vulnerability

If you discover a security vulnerability within `opencode-browser-use`, please do not open a public issue. Instead, report it privately to the maintainer:

- Email: israel@saba.dev (or via GitHub Security Advisories)
- Please provide a detailed description of the vulnerability, reproduction steps, and impact.
- You will receive an acknowledgment within 48 hours.
