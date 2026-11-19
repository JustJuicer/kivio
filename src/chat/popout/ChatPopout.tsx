import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getSettingsCached, subscribeSettings } from '../../api/settingsCache'
import { configureChatProtocolFilter } from '../../api/chatProtocol'
import { SubagentSidebar } from '../AgentHub'
import { useDockSubagent } from '../hooks/useDockSubagent'
import { ChatTitlebar } from '../ChatTitlebar'
import { usesNativeTitlebar } from '../platform'
import { LangContext, type Lang } from '../../components/i18n'
import { getPopoutConversationId } from './popoutRoutes'
import { PopoutTitlebar } from './PopoutTitlebar'
import { usePopoutSession } from './usePopoutSession'
import { StandaloneConversationPane } from './StandaloneConversationPane'
import { AppDialogHost } from '../../components/AppDialog'

const popoutConversationId = getPopoutConversationId()
if (popoutConversationId) configureChatProtocolFilter(popoutConversationId)

type ChatPopoutProps = {
  onContentReady?: () => void
}

function ChatPopoutBody({
  conversationId,
  lang,
}: {
  conversationId: string
  lang: Lang
}) {
  const session = usePopoutSession(conversationId, lang)
  const subagent = useDockSubagent(conversationId)
  const titlebar = (
    <PopoutTitlebar
      conversation={session.conversation}
      runtime={session.runtime}
      externalAgent={session.externalAgent}
      usesExternalRuntime={session.usesExternalRuntime}
      approvalPolicy={session.approvalPolicy}
      onRuntimeChange={session.handleRuntimeChange}
      onModelChange={session.handleModelChange}
      onExternalModelChange={session.handleExternalModelChange}
      onThinkingLevelChange={session.handleThinkingLevelChange}
      onApprovalPolicyChange={session.handleApprovalPolicyChange}
      onSandboxChange={session.handleSandboxChange}
      busy={Boolean(session.inputBarProps.disabled)}
      workdir={session.workdir}
      projectName={session.inputBarProps.conversationProject?.name || null}
      historyBranches={session.conversation && !session.usesExternalRuntime ? {
        revision: session.conversation.revision,
        disabled: Boolean(session.inputBarProps.disabled),
        onSwitch: session.handleSwitchBranch,
      } : null}
      lang={lang}
    />
  )

  return (
    <div className={`chat-window-shell${usesNativeTitlebar ? ' chat-window-shell--native-titlebar' : ''}`}>
      {!usesNativeTitlebar && titlebar}
      <div className="flex min-h-0 w-full flex-1">
        <div className="chat-motion-pane-in chat-main-pane chat-main-pane--lone relative flex min-w-0 flex-1 flex-col">
          {usesNativeTitlebar && titlebar}
          <StandaloneConversationPane conversationId={conversationId} session={session} lang={lang} />
        </div>
        {subagent.selection && <aside className="flex min-h-0 w-[min(48%,24rem)] shrink-0 flex-col border-l border-[var(--color-border)]">
          <SubagentSidebar key={subagent.selection.agentId} target={subagent.selection} onBack={subagent.close} />
        </aside>}
      </div>
    </div>
  )
}

export default function ChatPopout({ onContentReady }: ChatPopoutProps) {
  const [lang, setLang] = useState<Lang>('zh')
  const readyRef = useRef(false)

  useLayoutEffect(() => {
    if (popoutConversationId) configureChatProtocolFilter(popoutConversationId)
  }, [])

  useLayoutEffect(() => {
    if (readyRef.current) return
    readyRef.current = true
    onContentReady?.()
  }, [onContentReady])

  useEffect(() => {
    void getSettingsCached().then((settings) => {
      setLang((settings.settingsLanguage as Lang) || 'zh')
    }).catch(() => {})
    return subscribeSettings((next) => {
      setLang((next.settingsLanguage as Lang) || 'zh')
    })
  }, [])

  if (!popoutConversationId) {
    return (
      <div className={`chat-window-shell${usesNativeTitlebar ? ' chat-window-shell--native-titlebar' : ''}`}>
        {!usesNativeTitlebar && (
          <ChatTitlebar
            hideNav
            sidebarExpanded={false}
            onToggleSidebar={() => {}}
            onNewConversation={() => {}}
          />
        )}
        <div className="flex min-h-0 w-full flex-1">
          <div className="chat-main-pane chat-main-pane--lone relative flex min-w-0 flex-1 flex-col">
            <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-neutral-500">
              无法打开独立对话窗口：缺少对话 id
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <LangContext.Provider value={lang}>
      <ChatPopoutBody conversationId={popoutConversationId} lang={lang} />
      <AppDialogHost />
    </LangContext.Provider>
  )
}
