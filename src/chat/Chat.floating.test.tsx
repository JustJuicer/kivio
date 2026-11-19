import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { api } from '../api/tauri'
import { chatApi } from './api'
import Chat from './Chat'

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onFocusChanged: async () => () => {} }) }))
vi.mock('@xterm/xterm', () => ({ Terminal: class {} }))
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class {} }))
vi.mock('../api/settingsCache', async original => ({
  ...await original<typeof import('../api/settingsCache')>(),
  getSettingsCached: async () => ({ chat: {}, providers: [] }),
}))
afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

function openChat(onContentReady?: () => void) {
  for (const key of Object.keys(api) as Array<keyof typeof api>) {
    if (key.startsWith('on') && typeof api[key] === 'function') vi.spyOn(api, key).mockResolvedValue(() => {})
  }
  vi.spyOn(api, 'rememberChatLastRoute').mockResolvedValue(undefined)
  vi.spyOn(api, 'chatSyncState').mockResolvedValue(undefined)
  vi.spyOn(api, 'scheduledTasksSnapshot').mockResolvedValue({ tasks: [], liveRuns: [] })
  const recent = { id: 'recent', title: 'Result review', provider_id: '', model: '', created_at: 1, updated_at: 1, revision: 1 }
  vi.spyOn(chatApi, 'getConversations').mockResolvedValue([{ ...recent, preview: '', message_count: 1 }])
  vi.spyOn(chatApi, 'getConversationWindow').mockResolvedValue({ ...recent, messages: [{ id: 'q', role: 'user', content: 'Earlier question', timestamp: 1 }] })
  window.history.replaceState(null, '', '#chat')
  return render(<Chat onSettingsChange={() => {}} onContentReady={onContentReady} />)
}

it('opens a separate window without replacing the main composer or route', async () => {
  const toggle = vi.spyOn(chatApi, 'toggleFloatingWindow').mockResolvedValue()
  openChat()
  const entry = await screen.findByRole('button', { name: '悬浮聊天' })
  const editor = document.querySelector('[contenteditable="true"]')
  fireEvent.click(entry)
  expect(toggle).toHaveBeenCalledTimes(1)
  expect(editor).toBeInTheDocument()
  expect(window.location.hash).toBe('#chat')
  expect(screen.queryByRole('button', { name: '会话列表' })).not.toBeInTheDocument()
})
