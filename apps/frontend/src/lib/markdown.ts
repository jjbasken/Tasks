import { Marked } from 'marked'
import createDOMPurify, { type DOMPurify } from 'dompurify'

const ATTACHMENT_PREFIX = 'attachment:'

function escapeAttr(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Rendered checkboxes are numbered in document order so a click in the preview
// can toggle the matching `[ ]` in the source. Parsing is synchronous, so a
// module-level counter reset per render is safe.
let taskIndex = 0

const marked = new Marked({ gfm: true, breaks: true })
marked.use({
  renderer: {
    checkbox({ checked }) {
      return `<input type="checkbox" data-task-index="${taskIndex++}"${checked ? ' checked' : ''}> `
    },
    // `attachment:<id>` is resolved after render: the bytes must be fetched and
    // decrypted first, and the sanitizer would strip the unknown scheme anyway.
    image({ href, text }) {
      if (!href?.startsWith(ATTACHMENT_PREFIX)) return false
      return `<img data-attachment-id="${escapeAttr(href.slice(ATTACHMENT_PREFIX.length))}" alt="${escapeAttr(text)}">`
    },
    link({ href, tokens }) {
      if (!href?.startsWith(ATTACHMENT_PREFIX)) return false
      return `<a href="#" data-attachment-id="${escapeAttr(href.slice(ATTACHMENT_PREFIX.length))}">${this.parser.parseInline(tokens)}</a>`
    },
  },
})

let purifier: DOMPurify | null = null
function getPurifier() {
  if (purifier) return purifier
  purifier = createDOMPurify(window)
  // Without a usable DOM, DOMPurify returns its input untouched. Fail closed.
  if (!purifier.isSupported) throw new Error('This browser cannot render notes safely.')
  purifier.addHook('afterSanitizeAttributes', node => {
    if (node.tagName === 'A' && node.getAttribute('href') && !node.hasAttribute('data-attachment-id')) {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
    if (node.tagName === 'INPUT' && node.getAttribute('type') !== 'checkbox') node.remove()
  })
  return purifier
}

/** Markdown to sanitized HTML. Raw HTML in a note never gets to run script. */
export function renderMarkdown(source: string): string {
  taskIndex = 0
  const html = marked.parse(source, { async: false })
  return getPurifier().sanitize(html, {
    FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'option', 'iframe', 'object', 'embed', 'svg', 'math'],
    FORBID_ATTR: ['style'],
  })
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const TASK = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/

/** Toggle the `index`th task-list checkbox in the source, skipping code fences. */
export function toggleTask(source: string, index: number): string {
  const lines = source.split('\n')
  let fence: string | null = null
  let seen = 0
  for (let i = 0; i < lines.length; i++) {
    const fenceMatch = lines[i].match(FENCE)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      if (!fence) fence = marker
      else if (fence === marker) fence = null
      continue
    }
    if (fence) continue
    const match = lines[i].match(TASK)
    if (!match) continue
    if (seen++ === index) {
      const mark = match[2] === ' ' ? 'x' : ' '
      lines[i] = `${match[1]}[${mark}]${lines[i].slice(match[0].length)}`
      return lines.join('\n')
    }
  }
  return source
}

export function attachmentMarkdown(id: string, name: string, isImage: boolean) {
  const label = name.replace(/[[\]]/g, '')
  return `${isImage ? '!' : ''}[${label}](${ATTACHMENT_PREFIX}${id})`
}

export type TextEdit = { text: string; selectionStart: number; selectionEnd: number }

/** Toolbar formatting: wrap the selection, or prefix each selected line. */
export function applyFormat(text: string, start: number, end: number, format: 'bold' | 'italic' | 'code' | 'link' | 'heading' | 'bullet' | 'checklist' | 'quote' | 'codeblock'): TextEdit {
  const selected = text.slice(start, end)
  const wrap = (before: string, after = before, placeholder = 'text'): TextEdit => {
    const inner = selected || placeholder
    const next = text.slice(0, start) + before + inner + after + text.slice(end)
    return { text: next, selectionStart: start + before.length, selectionEnd: start + before.length + inner.length }
  }
  const prefixLines = (prefix: string): TextEdit => {
    const lineStart = text.lastIndexOf('\n', start - 1) + 1
    const block = text.slice(lineStart, end)
    const prefixed = block.split('\n').map(line => prefix + line).join('\n')
    const next = text.slice(0, lineStart) + prefixed + text.slice(end)
    return { text: next, selectionStart: lineStart, selectionEnd: lineStart + prefixed.length }
  }
  switch (format) {
    case 'bold': return wrap('**')
    case 'italic': return wrap('_')
    case 'code': return wrap('`', '`', 'code')
    case 'link': return wrap('[', '](https://)', 'link')
    case 'codeblock': return wrap('```\n', '\n```', 'code')
    case 'heading': return prefixLines('## ')
    case 'bullet': return prefixLines('- ')
    case 'checklist': return prefixLines('- [ ] ')
    case 'quote': return prefixLines('> ')
  }
}
