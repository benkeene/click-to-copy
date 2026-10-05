/** One piece of a reply: prose between fences, or one fenced code block. */
export type Segment =
  | { kind: 'prose'; text: string }
  | { kind: 'code'; lang: string; code: string }

/** One fenced code block as it appears in a reply. */
export type Block = { lang: string; code: string }

export type CopyOptions = {
  /** How a multi-line block is flattened: `and`, `semicolon`, or `off`. */
  oneLine: string
  /** Remove a leading `$ ` or `% ` prompt from each line. */
  stripPrompt: boolean
}

const SHELL_LANGS = new Set([
  '', 'sh', 'bash', 'zsh', 'shell', 'console', 'fish', 'shell-session', 'shellsession',
])

/** True when a fence's info string names a shell, or names nothing. */
export const isShellLang = (lang: string): boolean => SHELL_LANGS.has(lang.toLowerCase())

/**
 * A reply split at its fences, in order: prose segments (the fence lines
 * themselves excluded, surrounding blank lines trimmed) and code segments.
 * A fence opens on a line of three or more backticks or tildes and closes on
 * a line of the same character at least as long; an unclosed fence runs to
 * the end of the text. An empty prose run between two fences is left out.
 */
export const splitSegments = (text: string): Segment[] => {
  const segments: Segment[] = []
  let prose: string[] = []
  let open: { char: string; len: number; lang: string; body: string[] } | null = null

  const flushProse = () => {
    const joined = prose.join('\n').replace(/^\n+|\n+$/g, '')
    if (joined !== '') segments.push({ kind: 'prose', text: joined })
    prose = []
  }

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (open === null) {
      const m = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)/.exec(line)
      if (m !== null) {
        flushProse()
        open = { char: m[1]![0]!, len: m[1]!.length, lang: m[2] ?? '', body: [] }
      } else {
        prose.push(line)
      }
      continue
    }
    const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)
    if (close !== null && close[1]![0] === open.char && close[1]!.length >= open.len) {
      segments.push({ kind: 'code', lang: open.lang, code: open.body.join('\n') })
      open = null
      continue
    }
    open.body.push(line)
  }
  if (open !== null) {
    if (open.body.length > 0) segments.push({ kind: 'code', lang: open.lang, code: open.body.join('\n') })
  } else {
    flushProse()
  }
  return segments
}

/** The fenced code blocks of a markdown text, in order. */
export const extractBlocks = (text: string): Block[] =>
  splitSegments(text).flatMap(s => (s.kind === 'code' ? [{ lang: s.lang, code: s.code }] : []))

/**
 * What a copied block becomes on the clipboard: continuations unwrapped,
 * prompts stripped, comments and blank lines dropped, lines joined per
 * `oneLine`. With `oneLine: 'off'` only the continuations are unwrapped and
 * the prompts stripped; the lines stay as written.
 */
export const toClipboardText = (code: string, options: CopyOptions): string => {
  const unwrapped = code.replace(/[ \t]*\\\r?\n[ \t]*/g, ' ')
  let lines = unwrapped.split('\n').map(l => l.replace(/\s+$/, ''))
  if (options.stripPrompt) {
    lines = lines.map(l => l.replace(/^[ \t]*[$%] /, ''))
  }
  if (options.oneLine === 'off') {
    return lines.join('\n').replace(/^\n+|\n+$/g, '')
  }
  const kept = lines.map(l => l.trim()).filter(l => l !== '' && !l.startsWith('#'))
  const glue = options.oneLine === 'semicolon' ? '; ' : ' && '
  return kept.join(glue)
}
