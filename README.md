# click-to-copy

A Claude Code mod that draws a `[ copy ]` button under every fenced code block
in Claude's replies. One click puts the block on your clipboard, flattened to a
one-liner, ready to paste into another terminal.

```
⏺ Install it and run it:

    brew install foo \
      --with-bar

  [ copy ]  click to copy
```

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
- the remaining lines are joined with ` && `

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

`and` is right for the common case of one command per block, or a short
sequence. It is wrong for a block holding a heredoc, a `for`/`if` body, or a
function definition, which `&&` cannot flatten: switch to `off` for those, or
just select the text.

## Pair it with a CLAUDE.md rule

The buttons only appear under fenced blocks, so tell Claude to stop suggesting
the `!` prefix and to fence commands instead. In `~/.claude/CLAUDE.md`:

```markdown
# Commands for me to run
Never tell me to run a command with the `!` prefix. Put any command I should
run myself in a fenced `bash` code block, one command per block, as a single
line with no line continuations.
```

## How it works

`hooks/register.tsx` hooks `ui.render` for the `AssistantMessage` component,
reads the reply's markdown off `e.props.text`, finds the fences, and returns a
tree: the same `Markdown` the engine would have drawn, then a row of `Button`s
whose `onPress` calls `$.ui.copy`. The stored message, and what the model sees,
are untouched. A reply over the `Markdown` element's 10,000 character bound is
left to the engine, so very long replies show no buttons.

## Develop

```sh
claude plugin validate .   # what the engine will load and refuse
claude plugin test .       # tests/*.test.tsx, run against the engine's own test kit
tsc -p .                   # once the engine has laid .claude-plugin/types/ beside the mod
```

## License

MIT
