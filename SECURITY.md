# Security

Report vulnerabilities privately through [GitHub security advisories](https://github.com/jjbasken/Tasks/security/advisories/new). Include reproduction steps, affected versions and the potential impact. Do not post secrets or exploitable details in public issues.

Security fixes target the current main branch. Upgrade deployments after fixes are released.

The repository uses CodeQL extended analysis, secret scanning and push protection, dependency alerts and security updates, weekly Dependabot updates, dependency review, dependency audits, and container and configuration scans. Workflow changes in a pull request take effect after merge for scheduled runs and Dependabot configuration.

Changes to main require a pull request, resolved review conversations, and passing checks. One approving reviewer is required; the owner account jjbasken can bypass the approval requirement through a pull request, but cannot bypass the separate PR and check requirements or push directly to main.

## Data stored on devices

After a passphrase sign-in, the app keeps an offline copy on that device. It holds the account's identity and the lists, tasks, and notes loaded there, all encrypted with a key derived from the passphrase. Session tokens and unlocked keys are never written to storage. A copy taken from the device can be attacked offline without the server's login rate limits, so its protection rests on the passphrase's strength and the key derivation cost. Users can remove the copy under Settings → Remove offline data and log out.
