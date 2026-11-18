import { List, Maximize2, Pin, PinOff, Plus } from 'lucide-react'
import { IconButton } from '../components/Button'
import { useT } from '../components/i18n'
import { WindowControls } from './WindowControls'
import { usesNativeTitlebar } from './platform'

type Props = {
  title?: string | null
  listOpen: boolean
  onOpenList: () => void
  onNew: () => void
  pinned: boolean
  busy: boolean
  onTogglePin: () => void
  onRestore: () => void
}

export function FloatingChatTitlebar({ title, listOpen, onOpenList, onNew, pinned, busy, onTogglePin, onRestore }: Props) {
  const t = useT()
  return (
    <header className={`flex h-10 shrink-0 items-center gap-1 pr-1 ${usesNativeTitlebar ? 'chat-titlebar-row chat-titlebar-row--collapsed-mac' : 'pl-2'}`} data-tauri-drag-region>
      <IconButton label={t.chatFloatingList} variant="ghost" aria-haspopup="dialog" aria-expanded={listOpen} onClick={onOpenList}>
        <List size={16} />
      </IconButton>
      <IconButton label={t.chatNewChat} variant="ghost" onClick={onNew}><Plus size={16} /></IconButton>
      <span className="min-w-0 flex-1 truncate text-sm" data-tauri-drag-region>{title || t.chatNewChat}</span>
      <IconButton label={pinned ? t.chatFloatingUnpin : t.chatFloatingPin} aria-pressed={pinned} disabled={busy} variant="ghost" onClick={onTogglePin}>
        {pinned ? <PinOff size={15} /> : <Pin size={15} />}
      </IconButton>
      <IconButton label={t.chatFloatingRestore} disabled={busy} variant="ghost" onClick={onRestore}><Maximize2 size={15} /></IconButton>
      {!usesNativeTitlebar && <WindowControls />}
    </header>
  )
}
