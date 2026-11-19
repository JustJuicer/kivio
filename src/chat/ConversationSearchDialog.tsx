import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Search } from 'lucide-react'
import { useT } from '../components/i18n'
import type { ConversationSearchHit, ChatProject, ChatSet } from './types'
import { HighlightText } from './searchHighlight'
import { displayConversationTitle, isPlaceholderTitle, isProvisionalTitle } from './conversationTitle'
import { SwapTitle } from './SwapTitle'

export function ConversationSearchDialog({
  query,
  results,
  currentConversationId,
  generatingConversationIds = new Set(),
  projects,
  sets,
  onQueryChange,
  onSelectConversation,
  onClose,
}: {
  query: string
  results: ConversationSearchHit[]
  currentConversationId?: string
  generatingConversationIds?: ReadonlySet<string>
  projects: ChatProject[]
  sets: ChatSet[]
  onQueryChange: (query: string) => void
  onSelectConversation: (conversation: ConversationSearchHit) => void
  onClose: () => void
}) {
  const t = useT()
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const normalizedQuery = query.trim()

  return createPortal(
    <div
      className="fixed inset-0 z-[260] flex items-start justify-center bg-black/45 px-5 pt-[16vh] dark:bg-black/60"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className="chat-motion-popover flex max-h-[62vh] w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 shadow-2xl shadow-black/25"
        role="dialog"
        aria-modal="true"
        aria-label={t.chatSearchConversations}
      >
        <div className="flex items-center gap-2 border-b border-neutral-200/80 px-3 py-2">
          <Search size={15} strokeWidth={1.75} className="shrink-0 text-neutral-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && results[0]) {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return
                event.preventDefault()
                onSelectConversation(results[0])
              }
            }}
            placeholder={t.chatSearchConversations}
            className="min-w-0 flex-1 bg-transparent text-[14px] font-medium text-neutral-900 outline-none placeholder:text-neutral-400 dark:placeholder:text-neutral-500"
          />
        </div>

        <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
          {normalizedQuery ? t.chatSearchResults : t.chatRecentConversations}
        </div>

        <div className="custom-scrollbar min-h-0 overflow-y-auto px-1.5 pb-1.5">
          {results.length > 0 ? (
            results.map((conversation, index) => {
              const active = conversation.id === currentConversationId
              const listedTitle =
                displayConversationTitle(conversation.title, conversation.preview)
                || t.chatLibUntitled
              const projectId = conversation.project_id ?? conversation.projectId
              const projectLabel = projects.find(project => project.id === projectId)?.name ?? conversation.folder
              const setId = conversation.set_id ?? conversation.setId ?? null
              const setLabel = setId ? sets.find((s) => s.id === setId)?.name ?? '' : ''
              const snippet = (conversation.match_snippet ?? conversation.matchSnippet ?? '').trim()
              const showSnippet = Boolean(
                normalizedQuery
                && snippet
                && snippet !== listedTitle
                && !isPlaceholderTitle(snippet),
              )
              return (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => onSelectConversation(conversation)}
                  style={{
                    ['--chat-motion-delay' as string]: `${Math.min(index, 12) * 18}ms`,
                  }}
                  className={`chat-motion-row group/search-result flex w-full min-w-0 items-start gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors ${
                    active
                      ? 'bg-neutral-900/[0.07]'
                      : 'hover:bg-neutral-900/[0.04]'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      {normalizedQuery ? (
                        <HighlightText
                          text={listedTitle}
                          query={normalizedQuery}
                          className={`min-w-0 flex-1 truncate text-[13px] font-medium ${
                            active
                              ? 'text-neutral-950'
                              : 'text-neutral-800'
                          }${
                            generatingConversationIds.has(conversation.id)
                            && isProvisionalTitle(listedTitle, conversation.preview)
                              ? ' kv-title-provisional'
                              : ''
                          }`}
                        />
                      ) : (
                        <SwapTitle
                          text={listedTitle}
                          title={listedTitle}
                          className={`min-w-0 flex-1 truncate text-[13px] font-medium ${
                            active
                              ? 'text-neutral-950'
                              : 'text-neutral-800'
                          }${
                            generatingConversationIds.has(conversation.id)
                            && isProvisionalTitle(listedTitle, conversation.preview)
                              ? ' kv-title-provisional'
                              : ''
                          }`}
                        />
                      )}
                      {setLabel && (
                        <span className="max-w-[100px] shrink-0 truncate text-[12px] text-neutral-400 dark:text-neutral-500">
                          {t.chatSetPrefix} · {setLabel}
                        </span>
                      )}
                      {!setLabel && projectLabel && (
                        <span className="max-w-[100px] shrink-0 truncate text-[12px] text-neutral-400 dark:text-neutral-500">
                          {projectLabel}
                        </span>
                      )}
                    </div>
                    {showSnippet && (
                      <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-neutral-500">
                        <HighlightText text={snippet} query={normalizedQuery} />
                      </p>
                    )}
                  </div>
                </button>
              )
            })
          ) : (
            <div className="px-3 py-6 text-center text-[13px] text-neutral-400 dark:text-neutral-500">
              {t.chatNoMatchingConversations}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
