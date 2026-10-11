/** One piece of a reply: prose between fences, or one fenced code block. */
export type Segment =
  | { kind: 'prose'; text: string }
  | {
      kind: 'code'
      lang: string
      code: string
      /** False for a fence the text ends inside: a reply still streaming. */
      isClosed: boolean
      /** The columns the fence sits in from the margin, as under a list item. */
      indent: number
    }

/** One fenced code block as it appears in a reply. */
export type Block = { lang: string; code: string }

export type CopyOptions = {
  /** `and` or `semicolon` joins a shell block's commands; anything else copies every block as written. */
  oneLine: string
  /** Remove a leading `$ ` or `% ` prompt from each command of a shell block. */
  stripPrompt: boolean
}

/** Shells whose grammar the scan follows: their blocks may be flattened. */
const JOINED_LANGS = new Set(['sh', 'bash', 'zsh', 'shell'])
/** Transcripts: prompted commands with their output between. */
const TRANSCRIPT_LANGS = new Set(['console', 'shell-session', 'shellsession'])

/** True when a fence's info string names a shell or a shell transcript. An untagged fence does not. */
export const isShellLang = (lang: string): boolean => {
  const l = lang.toLowerCase()
  return JOINED_LANGS.has(l) || TRANSCRIPT_LANGS.has(l) || l === 'fish'
}

/**
 * A reply split at its fences, in order: prose segments (the fence lines
 * themselves excluded, surrounding blank lines trimmed) and code segments.
 * A fence opens on a line of three or more backticks or tildes, at any
 * indent, and closes on a line of the same character at least as long; its
 * lines lose the opener's indent. A backtick fence whose info string holds
 * a backtick is no fence. An unclosed fence runs to the end of the text.
 *
 * `null` when the text holds markdown this does not follow, where drawing
 * the pieces apart would change the reply: a fence opening on a list
 * marker's or a blockquote's own line, or a reference link definition.
 */
export const splitSegments = (text: string): Segment[] | null => {
  const segments: Segment[] = []
  let prose: string[] = []
  let open: { char: string; len: number; lang: string; indent: number; body: string[] } | null = null

  const flushProse = () => {
    const joined = prose.join('\n').replace(/^\n+|\n+$/g, '')
    if (joined !== '') segments.push({ kind: 'prose', text: joined })
    prose = []
  }

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (open === null) {
      const m = /^( *)(`{3,}|~{3,})(.*)$/.exec(line)
      if (m !== null && (m[2]![0] === '~' || !m[3]!.includes('`'))) {
        flushProse()
        const lang = (/^[ \t]*([^\s]*)/.exec(m[3]!)![1] ?? '').replace(/^\{\.?|\}$/g, '')
        open = { char: m[2]![0]!, len: m[2]!.length, lang, indent: m[1]!.length, body: [] }
        continue
      }
      if (/^[ \t]*(?:>[ \t]*|(?:[-*+]|\d{1,9}[.)])[ \t]+)+(?:`{3,}|~{3,})/.test(line)) return null
      if (/^ {0,3}\[[^\]]+\]:[ \t]*\S/.test(line)) return null
      prose.push(line)
      continue
    }
    const close = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(line)
    if (close !== null && close[1]![0] === open.char && close[1]!.length >= open.len) {
      segments.push({ kind: 'code', lang: open.lang, code: open.body.join('\n'), isClosed: true, indent: open.indent })
      open = null
      continue
    }
    open.body.push(line.replace(new RegExp(`^ {0,${open.indent}}`), ''))
  }
  if (open !== null) {
    if (open.body.length > 0) {
      segments.push({ kind: 'code', lang: open.lang, code: open.body.join('\n'), isClosed: false, indent: open.indent })
    }
  } else {
    flushProse()
  }
  return segments
}

/** The fenced code blocks of a markdown text, in order. */
export const extractBlocks = (text: string): Block[] =>
  (splitSegments(text) ?? []).flatMap(s => (s.kind === 'code' ? [{ lang: s.lang, code: s.code }] : []))

/** One command of a shell block, with everything a backslash, a quote or a heredoc ties to it. */
export type ShellLine = {
  /** The command on one line: continuations unwrapped, prompt and comment removed. Empty for a blank or comment-only line. */
  text: string
  /** The line's `#` comment, if it has one. */
  comment: string
  /** As written, less a leading prompt: every physical line the command spans. */
  raw: string
  /** True when the line opened with a `$ ` or `% ` prompt that was stripped. */
  hadPrompt: boolean
  /** True when the command closes a `)` it did not open, as a `case` arm does. */
  hasStray: boolean
}

export type ShellScan = {
  lines: ShellLine[]
  /**
   * False when the scan met something it does not follow line by line: a
   * quote, a substitution or a group left open across a newline, a heredoc,
   * a continuation inside quotes.
   */
  isSound: boolean
}

type Nest = 'dq' | 'paren' | 'brace' | 'tick'

/**
 * A shell block read into its commands. Tracks quotes, `$( )`, `${ }` and
 * backticks so that a `#`, a backslash or a prompt is only taken for what it
 * is where the shell would take it so. Not a shell parser: whatever it
 * cannot follow it marks unsound, and the caller then copies `raw`.
 */
export const scanShell = (code: string, stripPrompt: boolean): ShellScan => {
  const src = code.replace(/\r\n?/g, '\n')
  const n = src.length
  const lines: ShellLine[] = []
  const stack: Nest[] = []
  const heredocs: { delim: string; stripTabs: boolean }[] = []
  let isSound = true
  let text = ''
  let comment = ''
  let raw = ''
  let hadPrompt = false
  let hasStray = false
  let atStart = true
  /** How much of `text` an escape or a quote ends, so that trimming leaves an escaped blank. */
  let held = 0
  let i = 0

  const take = (s: string) => {
    text += s
    raw += s
    i += s.length
  }
  const endLine = () => {
    const end = Math.max(held, text.replace(/\s+$/, '').length)
    lines.push({ text: text.slice(0, end).replace(/^\s+/, ''), comment, raw, hadPrompt, hasStray })
    text = comment = raw = ''
    hadPrompt = hasStray = false
    held = 0
    atStart = true
  }

  while (i < n) {
    const c = src[i]!
    const top = stack.at(-1)

    if (atStart) {
      atStart = false
      const lead = /^[ \t]*[$%] /.exec(src.slice(i, i + 256))
      if (stripPrompt && lead !== null) {
        hadPrompt = true
        i += lead[0].length
        continue
      }
    }

    if (c === '\n') {
      if (stack.length > 0) {
        isSound = false
        take(c)
        continue
      }
      i += 1
      for (const h of heredocs) {
        while (i < n) {
          const end = src.indexOf('\n', i)
          const body = src.slice(i, end < 0 ? n : end)
          raw += `\n${body}`
          i = end < 0 ? n : end + 1
          if ((h.stripTabs ? body.replace(/^\t+/, '') : body) === h.delim) break
        }
      }
      heredocs.length = 0
      endLine()
      continue
    }

    if (c === '\\') {
      if (src[i + 1] !== '\n') {
        if (i + 1 >= n) isSound = false
        take(src.slice(i, i + 2))
        held = text.length
        continue
      }
      if (stack.length > 0 || heredocs.length > 0) {
        isSound = false
        take('\\\n')
        continue
      }
      // The shell deletes the pair; any blank on either side still separates words.
      const indent = /^[ \t]*/.exec(src.slice(i + 2))![0]
      const trimmed = text.replace(/[ \t]+$/, '')
      text = trimmed + (trimmed.length < text.length || indent !== '' ? ' ' : '')
      raw += `\\\n${indent}`
      i += 2 + indent.length
      continue
    }

    if (top !== 'dq') {
      if (c === "'") {
        const isAnsi = src[i - 1] === '$'
        let end = i + 1
        while (end < n && src[end] !== "'") end += isAnsi && src[end] === '\\' ? 2 : 1
        if (end >= n) isSound = false
        const quoted = src.slice(i, Math.min(end + 1, n))
        if (quoted.includes('\n')) isSound = false
        take(quoted)
        continue
      }
      if (c === '#' && (i === 0 || /[\s;&|(]/.test(src[i - 1]!)) && top !== 'brace') {
        const end = src.indexOf('\n', i)
        const rest = src.slice(i, end < 0 ? n : end)
        comment = rest
        raw += rest
        i += rest.length
        continue
      }
      if (c === '<' && src[i + 1] === '<') {
        if (src[i + 2] === '<') {
          take('<<<')
          continue
        }
        const m = /^<<(-?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|([^\s;&|<>()]+))/.exec(src.slice(i, i + 256))
        isSound = false
        if (m !== null) {
          heredocs.push({ delim: m[2] ?? m[3] ?? m[4]!.replace(/\\/g, ''), stripTabs: m[1] === '-' })
          take(m[0])
        } else {
          take('<<')
        }
        continue
      }
      if (c === '(') {
        stack.push('paren')
        take(c)
        continue
      }
      if (c === ')') {
        if (top === 'paren') stack.pop()
        else hasStray = true
        take(c)
        continue
      }
    }

    if (c === '"') {
      if (top === 'dq') stack.pop()
      else stack.push('dq')
    } else if (c === '`') {
      if (top === 'tick') stack.pop()
      else stack.push('tick')
    } else if (c === '$' && src[i + 1] === '(') {
      stack.push('paren')
      take('$(')
      continue
    } else if (c === '$' && src[i + 1] === '{') {
      stack.push('brace')
      take('${')
      continue
    } else if (c === '}' && top === 'brace') {
      stack.pop()
    }
    take(c)
  }

  if (stack.length > 0 || heredocs.length > 0) isSound = false
  if (text !== '' || comment !== '' || raw !== '' || hadPrompt) endLine()
  return { lines, isSound }
}

const RESERVED =
  /^(if|then|elif|else|fi|for|while|until|do|done|case|esac|select|function|time|coproc)(?![\w-])|^[{}!](\s|$)|^\[\[|^\(\(/

/** Builtins that change how the lines after them are read or run, which a join onto one line would defeat. */
const STATEFUL = /^(set|shopt|setopt|unsetopt|alias|unalias|trap)(\s|$)/

const count = (text: string, re: RegExp): number => text.match(re)?.length ?? 0

/**
 * True when a command can stand between two joins: no reserved word opening
 * it, no operator dangling at either end, no group left open, no `$?` that
 * reads the command before it, no `set -e` or `alias` whose effect depends
 * on the line break. A one-line loop is not plain either; a block holding
 * one is copied as written.
 */
export const isPlainCommand = (text: string): boolean =>
  !RESERVED.test(text) &&
  !STATEFUL.test(text) &&
  !/^[|&;)}]/.test(text) &&
  !/[|&;({]$/.test(text) &&
  !/(^|[\s;])(then|do|else)$/.test(text) &&
  !/^[A-Za-z_][A-Za-z0-9_]*\s*\(\)/.test(text) &&
  !text.includes('$?') &&
  count(text, /(^|[\s;&|])\{(?=\s|$)/g) === count(text, /(^|[\s;])\}(?=$|[\s;&|)])/g)

/**
 * What a copied block becomes on the clipboard.
 *
 * Only a shell block is ever changed, and only where the scan followed all
 * of it. Its continuations are unwrapped, its prompts stripped, its comments
 * and blank lines dropped, and its commands joined per `oneLine`. A block
 * tagged as a transcript (`console`) keeps its prompted commands and drops
 * the rest as output.
 *
 * Everything else is copied as written, exactly: another language, an
 * untagged block, `oneLine` set to anything but a join, a heredoc or a
 * quote spanning lines, a `bash` block where only some lines carry a prompt
 * (output and unprompted commands cannot be told apart). A block of loops,
 * groups or dangling operators keeps its lines and loses only its prompts.
 * The clipboard never holds a command the block does not show.
 */
export const toClipboardText = (block: Block, options: CopyOptions): string => {
  const { code } = block
  const lang = block.lang.toLowerCase()
  const isTranscript = TRANSCRIPT_LANGS.has(lang)
  if (options.oneLine !== 'and' && options.oneLine !== 'semicolon') return code
  if (!JOINED_LANGS.has(lang) && !isTranscript) return code

  const scan = scanShell(code, options.stripPrompt)
  if (!scan.isSound) return code

  const isCommand = (l: ShellLine) => l.text !== ''
  const isPlain = (l: ShellLine) => !l.hasStray && isPlainCommand(l.text)
  const all = scan.lines.filter(isCommand)
  const prompted = all.filter(l => l.hadPrompt)
  let lines = scan.lines
  if (prompted.length < all.length && (isTranscript || prompted.length > 0)) {
    if (!isTranscript || prompted.length === 0 || !prompted.every(isPlain)) return code
    lines = scan.lines.filter(l => l.hadPrompt)
  }

  const commands = lines.filter(isCommand)
  if (commands.length === 0) return code
  if (commands.length > 1 && !commands.every(isPlain)) return lines.map(l => l.raw).join('\n')
  return commands.map(l => l.text).join(options.oneLine === 'semicolon' ? '; ' : ' && ')
}
