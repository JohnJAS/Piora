# Security Policy

## Supported versions

piGUI is currently pre-release. Security fixes are applied to the current default branch; older snapshots and unofficial binaries are not guaranteed to receive fixes.

| Version | Supported |
| --- | --- |
| Current default branch | Yes |
| Older snapshots or forks | No guarantee |

This policy will be replaced with a release support table before stable binaries are published.

## Reporting a vulnerability

Please do **not** open a public issue for a suspected vulnerability.

Use [GitHub Private Vulnerability Reporting](https://github.com/kexijiang/pi-gui/security/advisories/new), or open the repository's **Security** tab and select **Report a vulnerability**. If that feature is unavailable, privately contact the repository owner through the contact method on their GitHub profile and ask for a secure reporting channel without including exploit details in the first message.

Include, when available:

- the affected commit or version;
- operating system and installation method;
- a minimal reproduction or proof of concept;
- impact and the trust boundary that can be crossed;
- relevant logs with API keys, tokens, prompts, paths, and personal data removed;
- whether you believe active exploitation is occurring.

We will acknowledge receipt when maintainers are available, investigate, and coordinate disclosure and credit with the reporter. Please allow time for a fix and release before publishing details.

## Areas of particular interest

- access outside an approved workspace or file allow-list;
- command execution without the expected user approval or policy check;
- credential, OAuth token, API key, prompt, or session-data disclosure;
- cross-site scripting, unsafe external navigation, or renderer-to-host privilege escalation;
- unauthenticated access to a local agent API;
- path traversal or symlink-based boundary escapes;
- malicious session, Markdown, extension, skill, package, or model data leading to code execution;
- dependency vulnerabilities with a demonstrated reachable impact in piGUI.

## Expected behavior and limitations

Pi agent tools can read files, write files, start processes, and use the network with the permissions of the current operating-system user. Prompt injection and a user-approved command doing what it visibly says are important risks, but are not automatically product vulnerabilities. Reports are most actionable when they demonstrate bypass of a documented boundary, approval, or security control.

Never send real credentials or sensitive session files as a reproduction. Use test accounts and synthetic data.

Only binaries published through this repository's official release process will be covered once releases begin. Third-party forks and repackaged binaries must be reported to their distributors as well.
