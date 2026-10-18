---
description: Open Autoreach, or show its status, or stop its server
argument-hint: "[status|stop]"
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/autoreach.mjs" $ARGUMENTS`

Relay the output above to the user in a few lines. If it lists pending offers, list each one. If the command failed because `node` was not found, tell the user to install Node.js 22.13 or newer from https://nodejs.org and run /autoreach again. Do not run any other command.
