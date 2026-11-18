import { act, fireEvent, render, screen, within } from '@testing-library/react'
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

function openChat() {
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
  return render(<Chat onSettingsChange={() => {}} />)
}

it('accepts repeated capture intents and switches chats from the compact conversation list', async () => {
  const geometry = vi.spyOn(chatApi, 'setFloatingMode').mockResolvedValue(undefined)
  openChat()
  await act(async () => {
    window.dispatchEvent(new Event('kivio:enter-floating-chat'))
    window.dispatchEvent(new Event('kivio:enter-floating-chat'))
  })
  fireEvent.click(await screen.findByRole('button', { name: '会话列表' }))
  const list = await screen.findByRole('dialog')
  fireEvent.click(await within(list).findByRole('button', { name: 'Result review' }))
  expect(await screen.findByText('Earlier question', {}, { timeout: 8000 })).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '新建聊天' }))
  expect(await screen.findByRole('button', { name: '恢复主界面' })).toBeInTheDocument()
  expect(screen.queryByText('Earlier question')).not.toBeInTheDocument()
  expect(geometry.mock.calls).toEqual([[true]])
})

it('shows only confirmed window pin state and keeps restore available after a native failure', async () => {
  const geometry = vi.spyOn(chatApi, 'setFloatingMode').mockResolvedValue(undefined)
  openChat()
  fireEvent.click(await screen.findByRole('button', { name: '悬浮聊天' }))
  const pin = await screen.findByRole('button', { name: '窗口置顶' })
  const nativePin = vi.spyOn(chatApi, 'setWindowPinned').mockRejectedValueOnce(new Error('denied')).mockResolvedValue(undefined)
  await act(async () => { fireEvent.click(pin) })
  expect(pin).toHaveAttribute('aria-pressed', 'false')
  await act(async () => { fireEvent.click(pin) })
  expect(pin).toHaveAttribute('aria-pressed', 'true')
  await act(async () => { fireEvent.click(pin) })
  expect(nativePin.mock.calls).toEqual([[true], [true], [false]])
  geometry.mockRejectedValueOnce(new Error('restore failed'))
  const restore = screen.getByRole('button', { name: '恢复主界面' })
  await act(async () => { fireEvent.click(restore) })
  expect(restore).toBeEnabled()
  await act(async () => { fireEvent.click(restore) })
  expect(screen.getByRole('button', { name: '悬浮聊天' })).toBeInTheDocument()
})

it('switches the existing chat composer into a compact window and back without replacing it', async () => {
  openChat()
  const entry = await screen.findByRole('button', { name: '悬浮聊天' })
  const composer = document.querySelector('[contenteditable="true"], textarea')
  expect(composer).not.toBeNull()
  fireEvent.click(entry)
  const restore = await screen.findByRole('button', { name: '恢复主界面' })
  expect(screen.queryByRole('button', { name: '展开侧栏' })).not.toBeInTheDocument()
  expect(composer).toBeInTheDocument()
  fireEvent.click(restore)
  expect(await screen.findByRole('button', { name: '悬浮聊天' })).toBeInTheDocument()
  expect(composer).toBeInTheDocument()
})
