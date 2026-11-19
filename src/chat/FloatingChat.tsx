import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import { flushSync } from 'react-dom'
import { LangContext, type Lang } from '../components/i18n'
import { AppDialogHost } from '../components/AppDialog'
import { notifyError } from '../components/appNoticeStore'
import { configureChatProtocolFilter } from '../api/chatProtocol'
import { getSettingsCached } from '../api/settingsCache'
import { chatApi } from './api'
import { draftKey, migrateNewChatDraft } from './composerDraft'
import { preferredComposerModel } from './composerPreferences'
import { ConversationSearchDialog } from './ConversationSearchDialog'
import { FloatingChatTitlebar } from './FloatingChatTitlebar'
import { useFloatingCaptures } from './hooks/useFloatingCaptures'
import { InputBar, type InputBarProps } from './InputBar'
import { StandaloneConversationPane } from './popout/StandaloneConversationPane'
import { usePopoutSession } from './popout/usePopoutSession'
import type { Conversation, ConversationSearchHit } from './types'

type Selection = { id: string; title: string; initial?: Conversation }
type Send = InputBarProps['onSend']

function Session({ selected, lang, send }: {
  selected: Selection; lang: Lang; send: MutableRefObject<Send | null>
}) {
  const session = usePopoutSession(selected.id, lang, selected.initial)
  useLayoutEffect(() => {
    send.current = session.inputBarProps.onSend
    return () => { send.current = null }
  }, [send, session.inputBarProps.onSend])
  return <StandaloneConversationPane conversationId={selected.id} lang={lang} session={session} />
}

function History({ current, select, close }: {
  current?: string; select: (item: ConversationSearchHit) => void; close: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ConversationSearchHit[]>([])
  useEffect(() => {
    let active = true
    const timer = setTimeout(async () => {
      try {
        const items = query.trim() ? await chatApi.searchConversations(query) : await chatApi.getConversations()
        if (active) setResults(items)
      } catch (error) { if (active) notifyError(String(error)) }
    }, query.trim() ? 150 : 0)
    return () => { active = false; clearTimeout(timer) }
  }, [query])
  return <ConversationSearchDialog query={query} results={results} currentConversationId={current}
    projects={[]} sets={[]} onQueryChange={value => { setResults([]); setQuery(value) }}
    onSelectConversation={select} onClose={close} />
}

export default function FloatingChat({ lang }: { lang: Lang }) {
  const [selected, setSelected] = useState<Selection | null>(null)
  const [history, setHistory] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [busy, setBusy] = useState(false)
  const changing = useRef(false)
  const send = useRef<Send | null>(null)
  const mounted = useRef(false)
  useLayoutEffect(() => {
    mounted.current = true
    configureChatProtocolFilter('') // no wildcard subscription in the empty composer
    return () => { mounted.current = false }
  }, [])
  useFloatingCaptures(() => ({ key: draftKey(selected?.id), reveal: () => setHistory(false) }))

  async function change<T,>(action: () => Promise<T>): Promise<T | undefined> {
    if (changing.current) return
    changing.current = true
    setBusy(true)
    try { return await action() } catch (error) { notifyError(String(error)) }
    finally { changing.current = false; setBusy(false) }
  }

  async function select(next: Selection | null) {
    if (next?.id !== selected?.id) {
      await chatApi.claimFloatingConversation(next?.id ?? null)
      if (!mounted.current) return
      configureChatProtocolFilter(next?.id ?? '')
      if (next?.initial) migrateNewChatDraft(draftKey(null), next.id)
      // Install the session's send port before forwarding an explicit first send.
      flushSync(() => setSelected(next))
    }
    setHistory(false)
  }

  const firstSend: Send = async (content, attachments, options) => {
    if (changing.current) return false
    const submit = await change(async () => {
      const model = preferredComposerModel(await getSettingsCached())
      const created = await chatApi.createConversation(model.providerId || undefined, model.model || undefined)
      if (!mounted.current) return
      await select({ id: created.id, title: created.title, initial: created })
      return send.current
    })
    // No effect replays this intent (including React StrictMode). The original
    // editor's acceptance callback follows its migrated draft operation.
    return submit ? submit(content, attachments, options) : false
  }

  return <LangContext.Provider value={lang}>
    <div className="chat-window-shell" data-floating>
      <FloatingChatTitlebar title={selected?.title} listOpen={history} onOpenList={() => setHistory(true)}
        onNew={() => void change(() => select(null))} busy={busy} pinned={pinned}
        onTogglePin={() => void change(async () => { await chatApi.setWindowPinned(!pinned); setPinned(!pinned) })}
        captureLabel={lang === 'zh' ? '截屏并添加到草稿' : 'Capture screen and attach'}
        onCapture={() => void change(() => chatApi.captureForFloatingWindow())}
        onHide={() => void change(() => chatApi.toggleFloatingWindow())} />
      <main className="chat-main-pane chat-main-pane--lone relative flex min-h-0 min-w-0 flex-1 flex-col">
        {selected ? <Session key={selected.id} selected={selected} lang={lang} send={send} /> : <>
          <div className="flex-1" />
          <InputBar autoFocus disabled={busy} onSend={firstSend} showProjectEntry={false} />
        </>}
      </main>
      {history && <History current={selected?.id} select={item => void change(() => select(item))} close={() => setHistory(false)} />}
    </div>
    <AppDialogHost />
  </LangContext.Provider>
}
