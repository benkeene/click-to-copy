import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { extractBlocks, isPlainCommand, scanShell, splitSegments, toClipboardText } from '../hooks/blocks'
import { COMMANDS_SECTION } from '../hooks/register'

const REPLY = [
  'Install it and run it:',
  '',
  '```bash',
  '$ brew install foo \\',
  '    --with-bar',
  '```',
  '',
  'Then check:',
  '',
  '```sh',
  '# the version',
  'foo --version',
  'foo doctor',
  '```',
  '',
  '```python',
  'print(1)',
  '```',
  '',
].join('\n')

/** A `bash` block's clipboard text under the default options, or those given. */
const sh = (code: string, options: { oneLine?: string; stripPrompt?: boolean } = {}): string =>
  toClipboardText({ lang: 'bash', code }, { oneLine: 'and', stripPrompt: true, ...options })

/** What stands for the engine beneath the plugin: a surface that copies, toasts and draws its own row. */
const engine = (on: On) => {
  const copied: string[] = []
  const toasts: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine drew this'] }))
  return { copied, toasts }
}

/** The tags and keys of a tree's leaves in document order, for asserting layout. */
const outline = (node: unknown): string[] => {
  if (typeof node !== 'object' || node === null) return []
  const el = node as { type: string; props?: { key?: string; text?: string; source?: string }; children?: unknown[] }
  const own =
    el.type === 'Box' ? [] : [`${el.type}${el.props?.key ? `#${el.props.key}` : ''}`]
  return [...own, ...(el.children ?? []).flatMap(outline)]
}

describe('blocks', () => {
  test('splits a reply into prose and code segments in order', () => {
    const kinds = (splitSegments(REPLY) ?? []).map(s => (s.kind === 'code' ? `code:${s.lang}` : 'prose'))
    expect(kinds).toEqual(['prose', 'code:bash', 'prose', 'code:sh', 'code:python'])
    expect(splitSegments(REPLY)?.[0]).toEqual({ kind: 'prose', text: 'Install it and run it:' })
    expect(extractBlocks(REPLY)[1]?.code).toBe('# the version\nfoo --version\nfoo doctor')
  })

  test('closes only on a fence at least as long, and keeps an unclosed one', () => {
    const text = '````md\n```js\nx\n```\n````\n```\ntail'
    expect(extractBlocks(text).map(b => b.code)).toEqual(['```js\nx\n```', 'tail'])
  })

  test('reads a fence under a list item, and its lines without the indent', () => {
    const text = '1. first\n\n   ```sh\n   echo hi\n     nested\n   ```\n\n2. second'
    expect(splitSegments(text)).toEqual([
      { kind: 'prose', text: '1. first' },
      { kind: 'code', lang: 'sh', code: 'echo hi\n  nested', isClosed: true, indent: 3 },
      { kind: 'prose', text: '2. second' },
    ])
  })

  test('takes the language from the info string, and no fence from an inline span', () => {
    expect(extractBlocks('```bash title="x"\na\n```\n~~~{.bash}\nb\n~~~')).toEqual([
      { lang: 'bash', code: 'a' },
      { lang: 'bash', code: 'b' },
    ])
    expect(extractBlocks('```not a fence``` here\nprose')).toEqual([])
  })

  test('marks a fence the text ends inside', () => {
    expect(splitSegments('```bash\necho "a')).toEqual([
      { kind: 'code', lang: 'bash', code: 'echo "a', isClosed: false, indent: 0 },
    ])
  })

  test('gives up on markdown it does not follow', () => {
    expect(splitSegments('- ```bash\n  echo hi\n  ```\nafter')).toBeNull()
    expect(splitSegments('> ```bash\n> echo hi\n> ```')).toBeNull()
    expect(splitSegments('See [guide][g].\n\n```sh\nls\n```\n\n[g]: /guide')).toBeNull()
  })

  test('flattens a shell block to a one-liner: continuations, prompts, comments, joins', () => {
    expect(sh('$ brew install foo \\\n    --with-bar')).toBe('brew install foo --with-bar')
    expect(sh('# the version\nfoo --version\n\nfoo doctor\n')).toBe('foo --version && foo doctor')
    expect(sh('a\nb', { oneLine: 'semicolon' })).toBe('a; b')
    // Anything but a join copies the block exactly, prompts and all.
    for (const oneLine of ['off', 'typo']) {
      expect(sh('$ a\n# c\n$ b \\\n  d\n', { oneLine })).toBe('$ a\n# c\n$ b \\\n  d\n')
    }
    expect(sh('$ a', { stripPrompt: false })).toBe('$ a')
    expect(sh('a \\\r\n  b\r\nc')).toBe('a b && c')
  })

  test('copies every other language, and an untagged block, as written', () => {
    const on = { oneLine: 'and', stripPrompt: true }
    for (const [lang, code] of [
      ['python', '# set up\nx = 1\ny = x + 1'],
      ['yaml', 'name: foo\n# note\nport: 80'],
      ['diff', '-old line\n+new line'],
      ['latex', '% preamble\n\\usepackage{amsmath}'],
      ['', 'error: file not found\n  at line 3'],
      ['fish', 'echo one\nand echo two'],
      ['python', '\n  indented = True  \n'],
    ] as const) {
      expect(toClipboardText({ lang, code }, on)).toBe(code)
    }
  })
})

describe('shell blocks', () => {
  test('a backslash joins words only where the shell would', () => {
    expect(sh('echo foo\\\nbar\nls')).toBe('echo foobar && ls')
    // A comment does not continue onto the next line.
    expect(sh('# note \\\nrm x\nls')).toBe('rm x && ls')
    // Inside quotes the indent is part of the string, so the block stays as written.
    expect(sh('echo "a \\\n   b"\nls')).toBe('echo "a \\\n   b"\nls')
  })

  test('drops a trailing comment and leaves a # that is no comment', () => {
    expect(sh('ls -la  # list\npwd')).toBe('ls -la && pwd')
    expect(sh("ls # it's fine\npwd")).toBe('ls && pwd')
    expect(sh('echo "a # b"\necho $#\ncurl http://x/y#frag\necho ${#x}')).toBe(
      'echo "a # b" && echo $# && curl http://x/y#frag && echo ${#x}',
    )
    expect(sh('echo "$(basename "$PWD") # no"\nls')).toBe('echo "$(basename "$PWD") # no" && ls')
  })

  test('a console transcript keeps its prompted commands and drops the output', () => {
    const console = (code: string) => toClipboardText({ lang: 'console', code }, { oneLine: 'and', stripPrompt: true })
    expect(console('$ git status\nOn branch main\nnothing to commit\n$ git log \\\n  --oneline\nabc123 msg')).toBe(
      'git status && git log --oneline',
    )
    // No prompt at all, or a prompted command left open: nothing says which lines are commands.
    expect(console('On branch main\nnothing to commit')).toBe('On branch main\nnothing to commit')
    expect(console('$ cat file |\n  grep foo')).toBe('$ cat file |\n  grep foo')
  })

  test('a bash block loses its prompts only when every command has one', () => {
    expect(sh('$ cd x\n$ make')).toBe('cd x && make')
    expect(sh('$ for f in *.log; do\n$   gzip "$f"\n$ done')).toBe('for f in *.log; do\n  gzip "$f"\ndone')
    // Output, or a second command? The text cannot say, so nothing is dropped and nothing is stripped.
    expect(sh('$ echo first\necho second')).toBe('$ echo first\necho second')
    expect(sh('$ git status\nOn branch main')).toBe('$ git status\nOn branch main')
    // `$(` and a job spec are not prompts.
    expect(sh('$(which python) -V\nfg %1')).toBe('$(which python) -V && fg %1')
  })

  test('never joins across a dangling operator', () => {
    for (const code of [
      'server &\ncurl localhost:8080',
      'cat file |\n  grep foo',
      'cat file\n  | grep foo',
      'make &&\nmake install',
      'cd /tmp;\nls',
    ]) {
      expect(sh(code)).toBe(code)
      expect(sh(code, { oneLine: 'semicolon' })).toBe(code)
    }
  })

  test('never joins a block holding shell structure', () => {
    for (const code of [
      'for f in *.log; do\n  gzip "$f"\ndone',
      'if [ -f x ]; then\n  rm x\nfi',
      'for f in *; do echo "$f"; done\nls',
      'while read -r l; do echo "$l"; done < f\nwc -l f',
      'case $x in\n  a) echo a ;;\nesac',
      'greet() {\n  echo hi\n}',
      '{\n  a\n  b\n} > out',
      '(\n  cd x\n  make\n)',
      'x=(\n  a\n  b\n)\necho ${x[@]}',
      'true && { echo one\necho two; }',
      'time (echo one\necho two)',
      '[[\n"$x" == a\n]]',
    ]) {
      expect(sh(code)).toBe(code)
    }
  })

  test('copies heredocs and strings that span lines exactly', () => {
    for (const code of [
      "cat > f <<'EOF'\n$ not a prompt\n# not a comment \\\nEOF\necho done",
      // Stripping the blank or the prompt would end the heredoc early and run its next line.
      "cat <<'EOF'\nEOF \nprintf unexpected\nEOF",
      "$ cat <<'EOF'\n$ EOF\nprintf unexpected\nEOF",
      'git commit -m "first\n\n$ second # x"\ngit push',
      "printf '%s' 'a\n# keep\n\nb'",
      "echo 'oops\nls",
    ]) {
      expect(sh(code)).toBe(code)
    }
  })

  test('never joins where the line break carries meaning', () => {
    for (const code of [
      'set -e\n(false; echo unexpected)\necho done',
      "alias hi='echo hello'\nhi",
      'false\necho "$?"',
    ]) {
      expect(sh(code)).toBe(code)
      expect(sh(code, { oneLine: 'semicolon' })).toBe(code)
    }
  })

  test('keeps an escaped blank at the end of a command', () => {
    expect(sh("printf '%s' x\\ ")).toBe("printf '%s' x\\ ")
    expect(sh("printf '%s' foo\\\\\necho next")).toBe("printf '%s' foo\\\\ && echo next")
  })

  test('joins what is plain: substitutions, here-strings, assignments', () => {
    expect(sh('mkdir -p x\ncd x\ngit init')).toBe('mkdir -p x && cd x && git init')
    expect(sh('v=$(git rev-parse HEAD)\necho "$v"')).toBe('v=$(git rev-parse HEAD) && echo "$v"')
    expect(sh('grep foo <<< "$x"\necho ok')).toBe('grep foo <<< "$x" && echo ok')
    expect(sh("echo $'it\\'s'\nls")).toBe("echo $'it\\'s' && ls")
    expect(sh('for f in *; do echo "$f"; done')).toBe('for f in *; do echo "$f"; done')
  })

  test('says which commands can stand in a join', () => {
    expect(isPlainCommand('git init')).toBe(true)
    expect(isPlainCommand('done')).toBe(false)
    expect(isPlainCommand('download x')).toBe(true)
    expect(isPlainCommand('time-machine --go')).toBe(true)
    expect(isPlainCommand('settings --list')).toBe(true)
    expect(isPlainCommand('{ a; b; }')).toBe(false)
    expect(isPlainCommand('echo {a,b}')).toBe(true)
    expect(scanShell('a \\\n b', true)).toEqual({
      isSound: true,
      lines: [{ text: 'a b', comment: '', raw: 'a \\\n b', hadPrompt: false, hasStray: false }],
    })
  })
})

describe('render', () => {
  test('each button sits right under its own block, with the payload beside it', async ($, on) => {
    const { copied, toasts } = engine(on)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'click-to-copy',
        surface,
        component: 'AssistantMessage',
        props: { text: REPLY, isFirstOfReply: true },
      })

      expect(outline(await ui.drawn())).toEqual([
        'Text',
        'Markdown',
        'Text', 'Code', 'Button#copy-1', 'Text',
        'Markdown',
        'Text', 'Code', 'Button#copy-2', 'Text',
        'Text', 'Code', 'Button#copy-3', 'Text',
      ])

      const payload1 = (await ui.find({ type: 'Text', text: /brew install/ }))?.text.trim()
      expect(payload1).toBe('brew install foo --with-bar')
      await ui.press({ key: 'copy-1' })
      expect(copied.at(-1)).toBe(payload1)

      const payload2 = (await ui.find({ type: 'Text', text: /foo --version/ }))?.text.trim()
      expect(payload2).toBe('foo --version && foo doctor')
      await ui.press({ key: 'copy-2' })
      expect(copied.at(-1)).toBe(payload2)
      expect(toasts.at(-1)).toBe('copied: foo --version && foo doctor')

      // The python block copies verbatim, so no payload line, just "as shown".
      expect(await ui.find({ type: 'Text', text: /print\(1\)/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /as shown/ })).toBeDefined()
      await ui.press({ key: 'copy-3' })
      expect(copied.at(-1)).toBe('print(1)')

      await ui.unmount()
    }
  })

  test('opens a first block with the reply bullet and indents a later one', async ($, on) => {
    engine(on)
    for (const [isFirstOfReply, lead] of [[true, '⏺ '], [false, '  ']] as const) {
      const ui = await $.ui.mount({
        plugin: 'click-to-copy',
        surface: 'terminal',
        component: 'AssistantMessage',
        props: { text: '```\nls\n```', isFirstOfReply },
      })
      expect((await ui.find({ type: 'Text' }))?.text).toBe(lead)
      await ui.unmount()
    }
  })

  test('a loop block shows "as shown" and copies its lines intact', async ($, on) => {
    const { copied } = engine(on)
    const code = 'for f in *.log; do\n  gzip "$f"\ndone'
    const ui = await $.ui.mount({
      plugin: 'click-to-copy',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: { text: '```bash\n' + code + '\n```', isFirstOfReply: true },
    })
    expect(await ui.find({ type: 'Text', text: /as shown/ })).toBeDefined()
    await ui.press({ key: 'copy-1' })
    expect(copied.at(-1)).toBe(code)
    await ui.unmount()
  })

  test('leaves a reply without a fence to the engine', async ($, on) => {
    engine(on)
    const ui = await $.ui.mount({
      plugin: 'click-to-copy',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: { text: 'Nothing to copy here.', isFirstOfReply: true },
    })
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    expect(await ui.find({ type: 'Text', text: /engine drew this/ })).toBeDefined()
    await ui.unmount()
  })

  test('leaves a reply it cannot split, and a block still streaming, without a button', async ($, on) => {
    engine(on)
    for (const [text, drawn] of [
      ['- ```bash\n  echo hi\n  ```\nafter', /engine drew this/],
      ['Run:\n\n```bash\necho hi', /engine drew this/],
    ] as const) {
      const ui = await $.ui.mount({
        plugin: 'click-to-copy',
        surface: 'terminal',
        component: 'AssistantMessage',
        props: { text, isFirstOfReply: true },
      })
      expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
      expect(await ui.find({ type: 'Text', text: drawn })).toBeDefined()
      await ui.unmount()
    }
  })

  test('copies a multi-line python block as shown', async ($, on) => {
    const { copied } = engine(on)
    const code = '# set up\nx = 1\ny = x + 1'
    const ui = await $.ui.mount({
      plugin: 'click-to-copy',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: { text: '```python\n' + code + '\n```', isFirstOfReply: true },
    })
    expect(await ui.find({ type: 'Text', text: /as shown/ })).toBeDefined()
    await ui.press({ key: 'copy-1' })
    expect(copied.at(-1)).toBe(code)
    await ui.unmount()
  })

  test('says so when the clipboard throws', async ($, on) => {
    const toasts: string[] = []
    on('ui.copy', () => {
      throw new Error('no clipboard')
    })
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    const ui = await $.ui.mount({
      plugin: 'click-to-copy',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: { text: '```bash\nls\n```', isFirstOfReply: true },
    })
    await ui.press({ key: 'copy-1' })
    expect(toasts.at(-1)).toMatch(/copy failed/)
    await ui.unmount()
  })

  test('shell-only mode draws the python block without a button', { options: { fences: 'shell' } }, async ($, on) => {
    engine(on)
    const ui = await $.ui.mount({
      plugin: 'click-to-copy',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: { text: REPLY, isFirstOfReply: true },
    })
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(2)
    expect(await ui.findAll({ type: 'Code' })).toHaveLength(3)
    await ui.unmount()
  })

  test('semicolon join follows the config and shows in the payload line', { options: { oneLine: 'semicolon' } }, async ($, on) => {
    const { copied } = engine(on)
    const ui = await $.ui.mount({
      plugin: 'click-to-copy',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: { text: '```bash\ncd x\nmake\n```', isFirstOfReply: true },
    })
    expect((await ui.find({ type: 'Text', text: /cd x/ }))?.text.trim()).toBe('cd x; make')
    await ui.press({ key: 'copy-1' })
    expect(copied.at(-1)).toBe('cd x; make')
    await ui.unmount()
  })
})

describe('prompt', () => {
  const ENGINE = [
    { id: 'intro', text: 'You are Claude Code.', scope: 'shared' },
    { id: 'tone', text: 'Be brief.', scope: 'session' },
  ] as const
  const FACTS = {
    model: 'claude-fable-5-1',
    promptModel: 'claude-fable-5-1',
    surfaces: ['terminal'],
    tools: ['Bash'],
    outputStyle: null,
    traits: [],
  } as const

  test('appends a session section telling Claude to fence commands', async ($, on) => {
    on('prompt.compose', () => ({ sections: ENGINE }))
    const { sections } = await $.prompt.compose(FACTS)
    expect(sections.map(s => s.id)).toEqual(['intro', 'tone', 'click-to-copy:commands'])
    expect(sections.at(-1)).toEqual(COMMANDS_SECTION)
    expect(COMMANDS_SECTION.text).toMatch(/`!` prefix/)
    expect(COMMANDS_SECTION.text).toMatch(/never write the command inline/)
    expect(COMMANDS_SECTION.text).toMatch(/one command per block/)
  })

  test('leaves the prompt alone when promptRule is off', { options: { promptRule: false } }, async ($, on) => {
    on('prompt.compose', () => ({ sections: ENGINE }))
    const { sections } = await $.prompt.compose(FACTS)
    expect(sections.map(s => s.id)).toEqual(['intro', 'tone'])
  })
})
