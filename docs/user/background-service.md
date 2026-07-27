# Running Vide in the Background

On a Linux host, Vide can run as a background service for your user. It starts when the machine
boots and keeps running after you log out.

## Manage the Service

Install it with the latest Vide release:

```sh
npx vide@latest service install
```

Check whether it is installed:

```sh
npx vide@latest service status
```

Update or repair it:

```sh
npx vide@latest service update
```

Stop it and remove it from startup:

```sh
npx vide@latest service uninstall
```

Updating restarts Vide briefly. Let active agent work and terminal commands finish first.

## Using It with Vide Connect

Vide Connect may offer to install the service during setup so the host stays reachable after you log
out. This is only an onboarding shortcut: the service and Vide Connect are managed separately.

Signing out of Vide Connect does not remove the service. Use `vide service uninstall` when you no longer
want Vide to start in the background.

The background service currently requires Linux with systemd.
