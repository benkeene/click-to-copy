# click-to-copy

A Claude Code mod that draws a `[ copy ]` button directly under every fenced
code block in Claude's replies, with the exact text it will copy beside it. One
click puts the block on your clipboard, flattened to a one-liner, ready to
paste into another terminal. It also asks Claude to fence the commands it
wants you to run, instead of suggesting the `!` prefix.

```
⏺ Install it and run it:

  ▎ brew install foo \
  ▎     --with-bar

  [ copy ]  brew install foo --with-bar

  Then check:

  ▎ foo --version

  [ copy ]  as shown
```

The button sits under its own block, so there is never a question of which
button copies what. When flattening changes the text, the result is printed
next to the button so you read what you are about to paste; when the block is
copied verbatim, the line says `as shown`. Hovering the button highlights the
block it belongs to. The toast after a press echoes the payload again.

Why: Claude Code likes to hand you commands as `! brew install foo`, meaning
"type this into the Claude Code prompt". Sometimes you would rather run it
yourself, in another terminal, over ssh, with a password prompt, or just not
through Claude. Selecting a wrapped command with the mouse and getting one
clean line back is fiddly. This mod makes it one click.

## Install

This is a function-hooks plugin ("mod"), an early-access part of Claude Code's
plugin system. It needs a recent Claude Code (built and tested on 2.1.289).

From a clone, for one session:

```sh
git clone https://github.com/benkeene/click-to-copy.git
claude --plugin-dir ./click-to-copy
```

Or as a marketplace, so `/plugin` can install and update it:

```
/plugin marketplace add benkeene/click-to-copy
/plugin install click-to-copy@benkeene
```

Mouse clicks on transcript buttons are reported in the fullscreen TUI layout.
If your terminal is not already in it, set `"tui": "fullscreen"` in
`~/.claude/settings.json` or pick it in `/config`. Without the mouse, Tab or a
click focuses the row and Enter presses the button.

The clipboard write is the same one `/copy` uses: a local clipboard tool when
there is one (`pbcopy`, `wl-copy`, `xclip`), else OSC 52. Over ssh or in tmux
that means your terminal must accept OSC 52 (iTerm2: *Prefs → General →
Selection → Applications in terminal may access clipboard*; tmux: `set -g
set-clipboard on`). macOS Terminal.app ignores OSC 52 entirely.

## What gets copied

A block is flattened before it reaches the clipboard:

- backslash line continuations are unwrapped
- a leading `$ ` or `% ` prompt is stripped from each line
- blank lines and `#` comment lines are dropped
- the remaining lines are joined with ` && `, unless the block holds shell
  structure (a loop, a conditional, a heredoc, a function), in which case the
  lines are kept as written

So this block

```bash
# install, then check
$ brew install foo \
    --with-bar
foo --version
```

copies as

```
brew install foo --with-bar && foo --version
```

## Options

Set them under `/config` or in `settings.json` under `pluginConfigs.click-to-copy`.

| option        | values                         | default | what it does                                                            |
| ------------- | ------------------------------ | ------- | ----------------------------------------------------------------------- |
| `oneLine`     | `and`, `semicolon`, `off`      | `and`   | how lines are joined; `off` keeps newlines (continuations still unwrap) |
| `fences`      | `all`, `shell`                 | `all`   | `shell` only draws buttons under `bash`/`sh`/`zsh`/`console`/untagged   |
| `stripPrompt` | `true`, `false`                | `true`  | drop a leading `$ ` / `% ` from each line                               |
| `promptRule`  | `true`, `false`                | `true`  | add the system-prompt section that asks Claude to fence commands        |

A block that `&&` cannot flatten is never joined, whatever `oneLine` says: one
holding a heredoc, an `if`/`for`/`while`/`until`/`case` body, a `{ }` or
`( )` group, or a function definition is copied line for line (continuations
still unwrapped, prompts still stripped), and its button says `as shown`. A
one-line loop such as `for f in *; do echo "$f"; done` is not compound and
joins like any other line.

## It also tells Claude to fence commands

The buttons only appear under fenced blocks, and out of the box Claude Code
tells Claude to hand you commands as `! command` instead. So the plugin adds
one short section to the system prompt: put a command the person should run
themselves in a fenced `bash` block of its own, one per block, on one line,
no `!` prefix. Nothing else about the prompt changes, and the section sits on
the session side of the prompt cache, so it costs nothing shared.

Turn it off with the `promptRule` option if you manage this in your own
CLAUDE.md, or just prefer the `!` suggestions.

## How it works

`hooks/register.tsx` hooks two events. `prompt.compose` appends the
commands section to whatever the engine composed. `ui.render` for the
`AssistantMessage` component reads the reply's markdown off `e.props.text`. `hooks/blocks.ts` splits it
at the fences into prose and code segments. The hook returns a tree in the
same order: each prose run as a `Markdown` element, each block as a `Code`
element with a `[ copy ]` `Button` and the payload line beneath it. A press
calls `$.ui.copy`. The stored message, and what the model sees, are untouched.
A reply with no fence is left to the engine entirely, as is one with a single
segment over the 10,000 character bound of a `Markdown` or `Code` element.

## Develop

```sh
claude plugin validate .   # what the engine will load and refuse
claude plugin test .       # tests/*.test.tsx, run against the engine's own test kit
tsc -p .                   # once the engine has laid .claude-plugin/types/ beside the mod
```

## License

MIT
