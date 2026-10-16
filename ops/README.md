# Ops: keep Delegra processes running on macOS

`ops/launchd/` has launchd user agents that start the Delegra agent and the demo client at login
and restart them if they crash. Paths assume the repo lives at `/Users/amithreddy/my-token` and
node at `/opt/homebrew/bin/node`; edit the plists if yours differ.

| Plist | Runs | Log |
|---|---|---|
| `com.delegra.agent.plist` | `node agent/agent.js` | `agent.log` |
| `com.delegra.demo-client.plist` | `node agent/demo-client.js` (INTERVAL_HOURS=6, PAYMENT=5) | `demo-client.log` |

Install and start:

```bash
cp ops/launchd/com.delegra.agent.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.delegra.agent.plist
```

Stop and uninstall:

```bash
launchctl bootout gui/$(id -u)/com.delegra.agent
rm ~/Library/LaunchAgents/com.delegra.agent.plist
```

Status: `launchctl print gui/$(id -u)/com.delegra.agent | grep state`. Swap `agent` for
`demo-client` to manage the demo client. Only load the demo client when the project wallet has
test ETH, since it posts a task every few hours.
