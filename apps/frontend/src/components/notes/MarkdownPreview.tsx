import { useEffect, useMemo, useRef, type MouseEvent } from 'react'
import { renderMarkdown } from '../../lib/markdown.js'

type Props = {
  text: string
  readOnly: boolean
  onToggleTask: (index: number) => void
  resolveImage?: (attachmentId: string) => Promise<string | null>
  onOpenAttachment?: (attachmentId: string) => void
}

export function MarkdownPreview({ text, readOnly, onToggleTask, resolveImage, onOpenAttachment }: Props) {
  const html = useMemo(() => renderMarkdown(text), [text])
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = container.current
    if (!root) return
    root.querySelectorAll<HTMLInputElement>('input[data-task-index]').forEach(box => { box.disabled = readOnly })
    if (!resolveImage) return
    let cancelled = false
    root.querySelectorAll<HTMLImageElement>('img[data-attachment-id]').forEach(img => {
      const id = img.dataset.attachmentId!
      img.classList.add('md-attachment-loading')
      resolveImage(id).then(url => {
        if (cancelled) return
        img.classList.remove('md-attachment-loading')
        if (url) img.src = url
        else img.replaceWith(Object.assign(document.createElement('span'), { className: 'md-attachment-missing', textContent: `[missing attachment: ${img.alt || id}]` }))
      })
    })
    return () => { cancelled = true }
  }, [html, readOnly, resolveImage])

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (target instanceof HTMLInputElement && target.dataset.taskIndex !== undefined) {
      e.preventDefault()
      if (!readOnly) onToggleTask(Number(target.dataset.taskIndex))
      return
    }
    const link = target.closest<HTMLElement>('[data-attachment-id]')
    if (link?.tagName === 'A') {
      e.preventDefault()
      onOpenAttachment?.(link.dataset.attachmentId!)
    }
  }

  return <div ref={container} className="md-preview" onClick={handleClick} dangerouslySetInnerHTML={{ __html: html }} />
}
