import type { Register } from 'claude-code'

import { isShellLang, splitSegments, toClipboardText } from './blocks'
import type { CopyOptions, Segment } from './blocks'

/** The bound of a Markdown or Code element's text; a longer piece is left to the engine. */
const LEAF_LIMIT = 10_000

/** What the model reads so that commands for the person land in fences, not behind `!`. */
export const COMMANDS_SECTION = {
  id: 'click-to-copy:commands',
  scope: 'session',
  text: [
    '# Commands for the person to run themselves',
    'When the person should run a shell command themselves (an interactive login,',
    'an ssh session, anything you cannot run for them), never tell them to type',
    'it with the `!` prefix into this prompt, and never write the command inline',
    'in backticks inside a sentence. Put it in a fenced `bash` code block of its',
    'own: one command per block, on a single line, no backslash continuations, no',
    'leading `$` prompt. This holds even when the answer is one or two sentences:',
    'the sentence says what the command does, the fence holds the command. Where',
    'this interface draws replies, a copy button sits under each fenced block, so',
    'a fence is what makes the command one click to copy.',
  ].join('\n'),
} as const

export const register: Register = (on, options) => {
  const copy: CopyOptions = {
    oneLine: options.oneLine === undefined ? 'and' : String(options.oneLine),
    stripPrompt: options.stripPrompt !== false,
  }
  const shellOnly = options.fences === 'shell'

  if (options.promptRule !== false) {
    on('prompt.compose', async ($, e, next) => {
      const composed = await next(e)
      return { sections: [...composed.sections, COMMANDS_SECTION] }
    })
  }

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const segments = splitSegments(e.props.text)
    if (segments === null) return next(e)
    // A fence still open is a reply still streaming: drawn, with no button until it closes.
    const wanted = (s: Segment) => s.kind === 'code' && s.isClosed && (!shellOnly || isShellLang(s.lang))
    if (!segments.some(wanted)) return next(e)
    if (segments.some(s => (s.kind === 'prose' ? s.text : s.code).length > LEAF_LIMIT)) return next(e)

    const { Box, Text, Button, Markdown, Code } = $.ui.resolve(e)
    // A hover scope is one group across the whole transcript, so name it by the reply.
    const reply = hash(e.props.text)
    let n = 0

    const body = segments.map((segment, index) => {
      const marginTop = index === 0 ? 0 : 1
      if (segment.kind === 'prose') {
        return (
          <Box marginTop={marginTop}>
            <Markdown text={segment.text} />
          </Box>
        )
      }
      if (!wanted(segment)) {
        return (
          <Box marginTop={marginTop} marginLeft={segment.indent}>
            <Code source={segment.code} language={segment.lang || undefined} />
          </Box>
        )
      }
      n += 1
      const i = n
      const scope = `block-${reply}-${i}`
      const flattened = toClipboardText(segment, copy)
      // The payload line is how the person reads a changed command, so one too long to draw is not changed.
      const payload = flattened.length > LEAF_LIMIT ? segment.code : flattened
      const isVerbatim = payload === segment.code
      return (
        <Box flexDirection="column" marginTop={marginTop} marginLeft={segment.indent}>
          <Box flexDirection="row">
            <Text dimColor hover={{ scope, dimColor: false, bold: true }}>▎ </Text>
            <Box flexGrow={1}>
              <Code source={segment.code} language={segment.lang || undefined} />
            </Box>
          </Box>
          <Box flexDirection="row" marginTop={1}>
            <Button
              key={`copy-${i}`}
              label="copy"
              hover={{ scope }}
              onPress={async press => {
                try {
                  const result = await $.ui.copy({ text: payload, surface: press.surface })
                  $.ui.toast(
                    result.isCopied ? `copied: ${preview(payload)}` : `copy failed (${result.reason})`,
                  )
                } catch {
                  $.ui.toast('copy failed')
                }
              }}
            />
            {isVerbatim ? (
              <Text dimColor>{'  as shown'}</Text>
            ) : (
              <Text dimColor wrap="wrap">{`  ${payload}`}</Text>
            )}
          </Box>
        </Box>
      )
    })

    // The engine opens a reply with a bullet and indents its text two cells
    // under it; a replaced tree draws neither, so draw them here.
    return (
      <Box flexDirection="row">
        <Text>{e.props.isFirstOfReply ? '⏺ ' : '  '}</Text>
        <Box flexDirection="column" flexGrow={1}>
          {body}
        </Box>
      </Box>
    )
  })
}

/** FNV-1a over a reply's text, enough to tell one reply's blocks from another's. */
const hash = (s: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}

const preview = (s: string): string => {
  const one = s.replace(/\n/g, ' ⏎ ')
  return one.length > 60 ? `${one.slice(0, 57)}...` : one
}
