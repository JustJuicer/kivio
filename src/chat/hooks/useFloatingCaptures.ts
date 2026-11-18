import { useEffect, useLayoutEffect, useRef } from 'react'
import { api } from '../../api/tauri'
import { notifyError } from '../../components/appNoticeStore'
import { updateComposerDraft } from '../composerDraft'

// take is destructive. A replacement Chat mount must claim the old mount's
// in-flight read rather than racing a second take and discarding the first.
let unclaimed: Promise<string[]> | null = null

export function useFloatingCaptures(target: () => { key: string; reveal: () => void }) {
  const latest = useRef(target)
  useLayoutEffect(() => { latest.current = target }, [target])
  useEffect(() => {
    let active = true
    let draining = false
    let requested = false
    let unlisten: (() => void) | undefined
    const drain = async () => {
      if (!active) return
      requested = true
      if (draining) return
      draining = true
      try {
        while (active && requested) {
          requested = unclaimed !== null // also check the inbox after claiming an earlier mount's read
          const take = unclaimed ??= api.chatTakeFloatingCaptures()
          let paths: string[]
          try { paths = await take } finally { if (active && unclaimed === take) unclaimed = null }
          if (!active || !paths.length) continue
          const { key, reveal } = latest.current()
          updateComposerDraft(key, draft => {
            const seen = new Set(draft.attachments.map(item => item.path))
            const additions = paths.flatMap(path => {
              if (!path || seen.has(path)) return []
              seen.add(path)
              return [{ type: 'image' as const, path, name: path.split(/[/\\]/).pop() || path, id: `pending-att-${crypto.randomUUID()}` }]
            })
            return { ...draft, attachments: [...draft.attachments, ...additions] }
          })
          reveal()
        }
      } catch (error) {
        if (active) notifyError(String(error))
      } finally { draining = false }
    }
    // Subscribe before the initial pull so no wake-up can fall between them.
    void api.onChatFloatingCapturesReady(() => { void drain() }).then(dispose => {
      if (!active) { dispose(); return }
      unlisten = dispose
      void drain()
    }).catch(error => { if (active) notifyError(String(error)) })
    return () => { active = false; unlisten?.() }
  }, [])
}
