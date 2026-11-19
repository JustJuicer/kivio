import { lazy, Suspense, type ReactNode } from 'react'
import { i18n, type Lang } from '../../components/i18n'
import type { usePopoutSession } from './usePopoutSession'
import { X } from 'lucide-react'
import { ApprovalCard } from '../ApprovalCard'
import { AskUserBlock } from '../AskUserBlock'
import { InputBar } from '../InputBar'
import { useStreamCoarse } from '../streamingStore'
import { useBackgroundTaskWait } from '../useBackgroundTaskWait'
import { GoalCard } from '../GoalCard'
import { composerGoal } from '../goalPresentation'
import { IconButton } from '../../components/Button'
import {
  isClaudePlanApproval,
  isCursorPlanApproval,
  isEnterPlanApproval,
  PLAN_APPROVAL_ACTIONS,
  toolApprovalTitle,
} from '../toolApproval'

const MessageList = lazy(() => import('../MessageList').then((module) => ({
  default: module.MessageList,
})))

function MessageListLoading() {
  return (
    <div className="chat-themed-surface flex flex-1 items-center justify-center">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-800 dark:border-t-neutral-200" />
    </div>
  )
}

function PopoutPendingSlot({
  session,
}: {
  session: ReturnType<typeof usePopoutSession>
}): ReactNode {
  const {
    pendingToolConfirm,
    pendingSessionConsent,
    pendingUserPrompt,
    pendingUserPromptRecord,
    toolConfirmError,
    sessionConsentError,
    toolConfirmSubmitting,
    sessionConsentSubmitting,
    resolveToolConfirm,
    resolveSessionConsent,
    dismissUserPrompt,
  } = session
  if (!pendingToolConfirm && !pendingSessionConsent && !pendingUserPrompt) return null
  return (
    <div className="shrink-0 px-4">
      <div className="mx-auto w-full max-w-4xl">
        {pendingUserPrompt && pendingUserPromptRecord && (
          <AskUserBlock
            variant="docked"
            key={pendingUserPrompt.interactionId}
            toolCall={pendingUserPromptRecord}
            interactionId={pendingUserPrompt.interactionId}
            onResolved={dismissUserPrompt}
          />
        )}
        {pendingToolConfirm && (
          <ApprovalCard
            key={pendingToolConfirm.interactionId}
            title={toolApprovalTitle(pendingToolConfirm)}
            subtitle={`${pendingToolConfirm.source}${pendingToolConfirm.serverId ? ` · ${pendingToolConfirm.serverId}` : ''}`}
            detail={pendingToolConfirm.argumentsPreview}
            error={toolConfirmError}
            actions={isClaudePlanApproval(pendingToolConfirm)
              ? [
                { label: '拒绝 / 让它改', disabled: toolConfirmSubmitting, onSelect: () => { void resolveToolConfirm(false) } },
                ...PLAN_APPROVAL_ACTIONS.map((action, index) => ({
                  label: action.label,
                  primary: index === PLAN_APPROVAL_ACTIONS.length - 1,
                  disabled: toolConfirmSubmitting,
                  onSelect: () => { void resolveToolConfirm(true, false, action.mode) },
                })),
              ]
              : isCursorPlanApproval(pendingToolConfirm)
                ? [
                  { label: '拒绝 / 让它改', disabled: toolConfirmSubmitting, onSelect: () => { void resolveToolConfirm(false) } },
                  { label: '批准', primary: true, disabled: toolConfirmSubmitting, onSelect: () => { void resolveToolConfirm(true) } },
                ]
              : isEnterPlanApproval(pendingToolConfirm)
                ? [
                  { label: '不用，直接做', disabled: toolConfirmSubmitting, onSelect: () => { void resolveToolConfirm(false) } },
                  { label: '进入计划模式', primary: true, disabled: toolConfirmSubmitting, onSelect: () => { void resolveToolConfirm(true) } },
                ]
                : [
                  { label: '拒绝', disabled: toolConfirmSubmitting, onSelect: () => { void resolveToolConfirm(false) } },
                  { label: '总是允许', disabled: toolConfirmSubmitting, onSelect: () => { void resolveToolConfirm(true, true) } },
                  { label: '允许一次', primary: true, disabled: toolConfirmSubmitting, onSelect: () => { void resolveToolConfirm(true) } },
                ]}
          />
        )}
        {pendingSessionConsent && (
          <ApprovalCard
            title="允许本次会话使用文件和命令工具？"
            error={sessionConsentError}
            actions={[
              { label: '拒绝', disabled: sessionConsentSubmitting, onSelect: () => { void resolveSessionConsent(false) } },
              { label: '允许本次会话', primary: true, disabled: sessionConsentSubmitting, onSelect: () => { void resolveSessionConsent(true) } },
            ]}
          />
        )}
      </div>
    </div>
  )
}

export function StandaloneConversationPane({ conversationId, lang, session }: {
  conversationId: string
  lang: Lang
  session: ReturnType<typeof usePopoutSession>
}) {
  const { streaming, streamFrozen } = useStreamCoarse()
  const stopBackgroundWait = useBackgroundTaskWait(streaming || streamFrozen || !session.conversation ? null : conversationId, lang)
  const visibleGoal = composerGoal(session.conversation?.goal_state ?? session.conversation?.goalState,
    session.conversation?.messages ?? [])
  return session.loadError ? (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-[13px] text-neutral-500">
      {session.loadError}
    </div>
  ) : (
    <>
      {session.streamError && (
        <div className="shrink-0 px-4 pt-2 text-center text-[12px] text-danger">
          {session.streamError}
        </div>
      )}
      {session.hookWarning && (
        <div className="flex items-start gap-2 px-4 pt-2">
          <div className="flex min-w-0 flex-1 items-start gap-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] leading-4 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200">
            <span className="min-w-0 flex-1">
              {i18n[lang].chatHookFailed
                .replace('{name}', session.hookWarning.hookName || session.hookWarning.event)
                .replace('{event}', session.hookWarning.event)}
              {` — ${session.hookWarning.message}`}
            </span>
            <IconButton
              size="xs"
              variant="ghost"
              label={i18n[lang].chatHookDismiss}
              onClick={session.dismissHookWarning}
            >
              <X size={12} />
            </IconButton>
          </div>
        </div>
      )}
      <Suspense fallback={<MessageListLoading />}>
        <MessageList key={conversationId} {...session.messageListProps} waitingForBackgroundTasks={Boolean(stopBackgroundWait)} />
      </Suspense>
      <PopoutPendingSlot session={session} />
      <InputBar {...session.inputBarProps} onStopBackgroundWait={stopBackgroundWait} goalSlot={visibleGoal && (
        <GoalCard
          goal={visibleGoal}
          onEdit={session.editGoal}
          onPause={session.pauseGoal}
          onResume={session.resumeGoal}
          onCancel={session.cancelGoal}
        />
      )} />
    </>
  )
}
