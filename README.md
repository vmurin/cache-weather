# cache-weather

A tiny Claude Code plugin that shows the prompt-cache countdown, the cache hit rate, how full the context is and your weekly limit, in the line under the prompt.

![The hint line under the Claude Code prompt with the cache-weather segment](docs/hint-line.svg)

## What it shows

| Part | Meaning |
| --- | --- |
| ☀️ 🌧️ ⛈️ | Context weather: sunny up to half the auto-compact threshold, rainy up to 80 % of it, stormy above |
| `46 min` | Time left on the prompt cache (5 min or 1 h, whichever your session uses), counted from the last response. Green, yellow in the last quarter, red in the last tenth, `expired` at zero |
| `hit 90%` | Share of the last response's input tokens served from the cache |
| `ctx 29%` | How full the context window is |
| `7d 66%` | Weekly (seven-day) usage limit |
| `⏳ 16.10. 08:00` | When the weekly limit resets, in local time |

## Takes no extra space

There is no new panel or band. The figures go at the end of Claude Code's own hint line under the prompt, the row that already shows the permission mode (`⏵⏵ auto mode on`). The mode pill stays Claude Code's own, in its own colour; only the `(shift+tab to cycle)` reminder is dropped.

## Why

- **Cache:** an expired cache makes the next request re-send the whole conversation at full price. The countdown tells you whether a pause has already cost you that.
- **Hit rate:** a low hit rate means the cache is being rebuilt.
- **Context weather:** warns before auto-compaction kicks in, so you can `/compact` at a good moment yourself.
- **Weekly limit:** how much of the week is left, and when it resets.

## Install

In Claude Code (terminal), type:

```
/plugin install cache-weather --marketplace vmurin/cache-weather
```

Answer `y` to add the marketplace, pick the user scope with Enter, and the line appears right away. In sessions that were already open, run `/reload-plugins`.

To remove it: `/plugin uninstall cache-weather`.

Tested on Claude Code 2.1.296.

## Development

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .   # run a session with this working copy
```

## Keywords

claude-code, claude-code-plugin, prompt-cache, cache-ttl, context-window, auto-compact, token-usage, rate-limit, statusline

## License

[MIT](LICENSE)
