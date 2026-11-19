import { Camera, List, Pin, PinOff, Plus, X } from 'lucide-react'
import { IconButton } from '../components/Button'
import { useT } from '../components/i18n'

type Props = {
  title?: string | null
  listOpen: boolean
  onOpenList: () => void
  onNew: () => void
  pinned: boolean
  busy: boolean
  onTogglePin: () => void
  onCapture: () => void
  captureLabel: string
  onHide: () => void
}

export function FloatingChatTitlebar({ title, listOpen, onOpenList, onNew, pinned, busy, onTogglePin, onCapture, captureLabel, onHide }: Props) {
  const t = useT()
  return (
    <header className="flex h-10 shrink-0 items-center gap-1 px-1" data-tauri-drag-region>
      <IconButton label={t.chatFloatingList} variant="ghost" aria-haspopup="dialog" aria-expanded={listOpen} disabled={busy} onClick={onOpenList}>
        <List size={16} />
      </IconButton>
      <IconButton label={t.chatNewChat} variant="ghost" disabled={busy} onClick={onNew}><Plus size={16} /></IconButton>
      <span className="min-w-0 flex-1 truncate text-sm" data-tauri-drag-region>{title || t.chatNewChat}</span>
      <IconButton label={pinned ? t.chatFloatingUnpin : t.chatFloatingPin} aria-pressed={pinned} disabled={busy} variant="ghost" onClick={onTogglePin}>
        {pinned ? <PinOff size={15} /> : <Pin size={15} />}
      </IconButton>
      <IconButton label={captureLabel} disabled={busy} variant="ghost" onClick={onCapture}><Camera size={15} /></IconButton>
      <IconButton label={t.chatWinClose} variant="ghost" onClick={onHide}><X size={15} /></IconButton>
    </header>
  )
}
