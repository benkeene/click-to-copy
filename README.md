# click-to-copy

A Claude Code mod that draws a `[ copy ]` button directly under every fenced
code block in Claude's replies, with the exact text it will copy beside it. One
click puts a shell block on your clipboard, flattened to a one-liner, ready to
paste into another terminal; a block in any other language is copied exactly
as written. It also asks Claude to fence the commands it
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

(Both blocks above are tagged `bash`.)

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

This is a function-hooks plugin ("mod"). Mods are on by default in Claude Code
2.1.287 and later; this one was built and tested on 2.1.296.

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

A block tagged `bash`, `sh`, `zsh` or `shell` is flattened before it reaches
the clipboard:

- backslash line continuations are unwrapped, the way the shell would
- a leading `$ ` or `% ` prompt is stripped from each command
- blank lines and `#` comments are dropped, a trailing `# comment` included
- the commands are joined with ` && `

So this block

```bash
# install, then check
$ brew install foo \
    --with-bar
$ foo --version  # should print 2.x
```

copies as

```
brew install foo --with-bar && foo --version
```

A `console` (or `shell-session`) block is a transcript: its `$ ` commands are
kept and joined, the output between them dropped.

Everything else is copied exactly as written, and its button says `as shown`:
any other language, `fish`, and a fence with no language tag at all.

### When a shell block is not joined

The clipboard should never hold a command the block does not show. So the
join happens only when every line is a plain command the plugin could follow
from end to end. Otherwise it leaves the lines alone:

| the block holds | what is copied |
| --- | --- |
| a heredoc, or a quote or `$( )` spanning lines | the block, exactly |
| `$ ` on some commands and not on others | the block, exactly: output and unprompted commands cannot be told apart |
| a loop, a conditional, a `case`, a function, a `{ }` or `( )` group | its lines, less the prompts |
| a line ending or starting with `\|`, `&`, `&&`, `\|\|` or `;` | its lines, less the prompts |
| `set`, `shopt`, `alias`, `trap`, or a `$?` | its lines, less the prompts: joining would change what they do |

A one-line loop such as `for f in *; do echo "$f"; done` alone in its block is
copied as it stands; next to other commands it keeps the block from joining.

Note what the join itself means: `a && b` does not run `b` when `a` fails,
where pasting the two lines would. That is the point of the default (a
sequence stops at its first failure). Set `oneLine` to `semicolon` to run on
regardless, or `off` to copy every block exactly as written.

## Options

Set them under `/config` or in `settings.json` under `pluginConfigs.click-to-copy`.

| option        | values                         | default | what it does                                                              |
| ------------- | ------------------------------ | ------- | ------------------------------------------------------------------------- |
| `oneLine`     | `and`, `semicolon`, `off`      | `and`   | how a shell block's commands are joined; `off` copies every block exactly |
| `fences`      | `all`, `shell`                 | `all`   | `shell` only draws buttons under `bash`/`sh`/`zsh`/`shell`/`fish`/`console` |
| `stripPrompt` | `true`, `false`                | `true`  | drop a leading `$ ` / `% ` from each command of a shell block             |
| `promptRule`  | `true`, `false`                | `true`  | add the system-prompt section that asks Claude to fence commands          |

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

For a shell block, `scanShell` in `hooks/blocks.ts` reads the text into
commands, tracking quotes, `$( )`, `${ }`, backticks and heredocs, so that a
`#`, a backslash or a `$ ` is only taken for a comment, a continuation or a
prompt where the shell would take it so. It is not a shell parser; whatever
it cannot follow, it says so, and the block is copied as written.

Some replies are left to the engine entirely, with no buttons:

- one with no fenced block
- one with a segment over the 10,000 character bound of a `Markdown` or `Code` element
- one whose markdown would not survive being drawn in pieces: a fence opening
  on a list marker's or blockquote's own line (`- ```bash`), or a reference
  link definition

A fence indented under a list item is read, and drawn at its indent; the list
around it is drawn as separate runs of prose, so a list numbered `1.` `1.`
`1.` restarts after each block. A block still streaming gets its button when
its fence closes.

## Develop

```sh
claude plugin validate .   # what the engine will load and refuse
claude plugin test .       # tests/*.test.tsx, run against the engine's own test kit
tsc -p .                   # once the engine has laid .claude-plugin/types/ beside the mod
```

## License

MIT
