import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { extractBlocks, toClipboardText } from '../hooks/blocks'

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
  '```',
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

describe('blocks', () => {
  test('extracts every fenced block with its language', () => {
    const blocks = extractBlocks(REPLY)
    expect(blocks.map(b => b.lang)).toEqual(['bash', '', 'python'])
    expect(blocks[1]?.code).toBe('# the version\nfoo --version\nfoo doctor')
  })

  test('closes only on a fence at least as long, and keeps an unclosed one', () => {
    const text = '````md\n```js\nx\n```\n````\n```\ntail'
    expect(extractBlocks(text).map(b => b.code)).toEqual(['```js\nx\n```', 'tail'])
  })

  test('flattens to a one-liner: continuations, prompts, comments, joins', () => {
    const on = { oneLine: 'and', stripPrompt: true }
    expect(toClipboardText('$ brew install foo \\\n    --with-bar', on)).toBe('brew install foo --with-bar')
    expect(toClipboardText('# the version\nfoo --version\n\nfoo doctor\n', on)).toBe('foo --version && foo doctor')
    expect(toClipboardText('a\nb', { ...on, oneLine: 'semicolon' })).toBe('a; b')
    expect(toClipboardText('$ a\n# c\nb \\\n  d\n', { ...on, oneLine: 'off' })).toBe('a\n# c\nb d')
    expect(toClipboardText('$ a', { ...on, stripPrompt: false })).toBe('$ a')
  })
})

describe('render', () => {
  test('draws one button per block and copies the pressed one on every surface', async ($, on) => {
    const { copied, toasts } = engine(on)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'click-to-copy',
        surface,
        component: 'AssistantMessage',
        props: { text: REPLY, isFirstOfReply: true },
      })
      expect(await ui.findAll({ type: 'Button' })).toHaveLength(3)
      expect((await ui.find({ key: 'copy-2' }))?.text).toBe('copy 2')
      expect(await ui.find({ type: 'Markdown', text: /Install it/ })).toBeDefined()

      await ui.press({ key: 'copy-1' })
      expect(copied.at(-1)).toBe('brew install foo --with-bar')
      await ui.press({ key: 'copy-2' })
      expect(copied.at(-1)).toBe('foo --version && foo doctor')
      expect(toasts.at(-1)).toMatch(/^copied block 2: foo --version/)
      await ui.unmount()
    }
  })

  test('a single block gets a plain "copy" button', async ($, on) => {
    engine(on)
    const ui = await $.ui.mount({
      plugin: 'click-to-copy',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: { text: 'Run:\n\n```sh\nls -la\n```\n', isFirstOfReply: true },
    })
    expect((await ui.find({ type: 'Button' }))?.text).toBe('copy')
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

  test('shell-only mode skips a python block', { options: { fences: 'shell' } }, async ($, on) => {
    engine(on)
    const ui = await $.ui.mount({
      plugin: 'click-to-copy',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: { text: REPLY, isFirstOfReply: true },
    })
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(2)
    await ui.unmount()
  })

  test('semicolon and off joins follow the config', { options: { oneLine: 'semicolon' } }, async ($, on) => {
    const { copied } = engine(on)
    const ui = await $.ui.mount({
      plugin: 'click-to-copy',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: { text: '```\ncd x\nmake\n```', isFirstOfReply: true },
    })
    await ui.press({ key: 'copy-1' })
    expect(copied.at(-1)).toBe('cd x; make')
    await ui.unmount()
  })
})
