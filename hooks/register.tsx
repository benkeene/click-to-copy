import type { Register } from 'claude-code'

import { isShellLang, splitSegments, toClipboardText } from './blocks'
import type { CopyOptions } from './blocks'

/** The bound of a Markdown or Code element's text; a longer piece is left to the engine. */
const LEAF_LIMIT = 10_000

/** What the model reads so that commands for the person land in fences, not behind `!`. */
export const COMMANDS_SECTION = {
  id: 'click-to-copy:commands',
  scope: 'session',
  text: [
    '# Commands for the person to run themselves',
    'When the person should run a shell command themselves, never tell them to',
    'type it with the `!` prefix into this prompt. Put the command in a fenced',
    '`bash` code block of its own: one command per block, on a single line, no',
    'backslash continuations, no leading `$` prompt. A copy button is drawn under',
    'every fenced block, so a fence is what makes the command copyable.',
  ].join('\n'),
} as const

export const register: Register = (on, options) => {
  const copy: CopyOptions = {
    oneLine: typeof options.oneLine === 'string' ? options.oneLine : 'and',
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
    const wanted = (s: (typeof segments)[number]) =>
      s.kind === 'code' && (!shellOnly || isShellLang(s.lang))
    if (!segments.some(wanted)) return next(e)
    if (segments.some(s => (s.kind === 'prose' ? s.text : s.code).length > LEAF_LIMIT)) return next(e)

    const { Box, Text, Button, Markdown, Code } = $.ui.resolve(e)
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
          <Box marginTop={marginTop}>
            <Code source={segment.code} language={segment.lang || undefined} />
          </Box>
        )
      }
      n += 1
      const i = n
      const scope = `block-${i}`
      const payload = toClipboardText(segment.code, copy)
      const isVerbatim = payload === segment.code.trim()
      return (
        <Box flexDirection="column" marginTop={marginTop}>
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
                const result = await $.ui.copy({ text: payload, surface: press.surface })
                $.ui.toast(
                  result.isCopied ? `copied: ${preview(payload)}` : `copy failed (${result.reason})`,
                )
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

const preview = (s: string): string => {
  const one = s.replace(/\n/g, ' ⏎ ')
  return one.length > 60 ? `${one.slice(0, 57)}...` : one
}
