import type { Register } from 'claude-code'

import { extractBlocks, isShellLang, toClipboardText } from './blocks'
import type { CopyOptions } from './blocks'

/** The Markdown element's bound; a longer reply is left to the engine. */
const MARKDOWN_LIMIT = 10_000

export const register: Register = (on, options) => {
  const copy: CopyOptions = {
    oneLine: typeof options.oneLine === 'string' ? options.oneLine : 'and',
    stripPrompt: options.stripPrompt !== false,
  }
  const shellOnly = options.fences === 'shell'

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const text = e.props.text
    if (text.length > MARKDOWN_LIMIT) return next(e)

    const blocks = extractBlocks(text).filter(b => !shellOnly || isShellLang(b.lang))
    if (blocks.length === 0) return next(e)

    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const several = blocks.length > 1

    return (
      <Box flexDirection="column">
        <Markdown text={text} />
        <Box flexDirection="row" gap={1} marginTop={1}>
          {blocks.map((block, i) => (
            <Button
              key={`copy-${i + 1}`}
              label={several ? `copy ${i + 1}` : 'copy'}
              onPress={async press => {
                const clip = toClipboardText(block.code, copy)
                const result = await $.ui.copy({ text: clip, surface: press.surface })
                $.ui.toast(
                  result.isCopied
                    ? `copied${several ? ` block ${i + 1}` : ''}: ${preview(clip)}`
                    : `copy failed (${result.reason})`,
                )
              }}
            />
          ))}
          <Text dimColor>{several ? 'click to copy a block' : 'click to copy'}</Text>
        </Box>
      </Box>
    )
  })
}

const preview = (s: string): string => (s.length > 48 ? `${s.slice(0, 45)}...` : s)
