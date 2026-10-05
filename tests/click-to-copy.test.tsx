import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { extractBlocks, splitSegments, toClipboardText } from '../hooks/blocks'

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
    const kinds = splitSegments(REPLY).map(s => (s.kind === 'code' ? `code:${s.lang}` : 'prose'))
    expect(kinds).toEqual(['prose', 'code:bash', 'prose', 'code:', 'code:python'])
    expect(splitSegments(REPLY)[0]).toEqual({ kind: 'prose', text: 'Install it and run it:' })
    expect(extractBlocks(REPLY)[1]?.code).toBe('# the version\nfoo --version\nfoo doctor')
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
      props: { text: '```\ncd x\nmake\n```', isFirstOfReply: true },
    })
    expect((await ui.find({ type: 'Text', text: /cd x/ }))?.text.trim()).toBe('cd x; make')
    await ui.press({ key: 'copy-1' })
    expect(copied.at(-1)).toBe('cd x; make')
    await ui.unmount()
  })
})
