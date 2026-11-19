import { act, render, waitFor, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { chatApi } from './api'
import { api } from '../api/tauri'
import App from '../App'
import Chat from './Chat'
import { draftKey, getComposerDraft, setComposerDraft } from './composerDraft'

vi.mock('@xterm/xterm', () => ({ Terminal: class {} }))
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class {} }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onFocusChanged: async () => () => {} }) }))
vi.mock('../api/chatProtocol', async original => ({
  ...await original<typeof import('../api/chatProtocol')>(), syncChatProtocol: async () => {},
}))
vi.mock('../api/settingsCache', async original => ({
  ...await original<typeof import('../api/settingsCache')>(),
  getSettingsCached: async () => ({ chat: {}, providers: [] }),
}))
const transport = vi.hoisted(() => ({ take: vi.fn(), listen: vi.fn() }))
vi.mock('../api/tauri', async original => {
  const actual = await original<typeof import('../api/tauri')>()
  return { ...actual, api: { ...actual.api, chatTakeFloatingCaptures: transport.take, onChatFloatingCapturesReady: transport.listen } }
})

afterEach(() => { vi.restoreAllMocks(); setComposerDraft(draftKey(null), { input: '', quotes: [], attachments: [] }) })

function setupCaptureTransport() {
  for (const key of Object.keys(api) as Array<keyof typeof api>) {
    if (key.startsWith('on') && key !== 'onChatFloatingCapturesReady') vi.spyOn(api, key).mockResolvedValue(() => {})
  }
  let wake!: () => void
  transport.listen.mockImplementation(async callback => { wake = callback; return () => {} })
  vi.spyOn(api, 'rememberChatLastRoute').mockResolvedValue(undefined)
  const send = vi.spyOn(chatApi, 'sendMessage')
  const create = vi.spyOn(chatApi, 'createConversation')
  vi.spyOn(api, 'scheduledTasksSnapshot').mockResolvedValue({ tasks: [], liveRuns: [] })
  transport.take.mockReset().mockResolvedValue([])
  return { wake: () => wake(), send, create }
}

it('never drains the independent window inbox from the main chat', async () => {
  setupCaptureTransport()
  window.history.replaceState(null, '', '#chat')
  render(<Chat onSettingsChange={() => {}} />)
  await screen.findByRole('button', { name: '悬浮聊天' })
  expect(transport.listen).not.toHaveBeenCalled()
  expect(transport.take).not.toHaveBeenCalled()
})

it('boots directly into the floating draft, keeps multiple captures and never consumes main open/send intents', async () => {
  const { wake, create, send } = setupCaptureTransport()
  transport.take.mockResolvedValueOnce(['/stage/a.png'])
  window.history.replaceState(null, '', '#floating-chat')
  const view = render(<App />)
  await screen.findByRole('button', { name: '会话列表' }, { timeout: 8000 })
  await waitFor(() => expect(getComposerDraft(draftKey(null))?.attachments).toHaveLength(1))
  fireEvent.click(screen.getByRole('button', { name: '会话列表' }))
  await screen.findByRole('dialog')
  transport.take.mockResolvedValueOnce(['/stage/b.png', '/stage/a.png'])
  await act(async () => { wake(); wake() })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(getComposerDraft(draftKey(null))?.attachments.map(a => a.name)).toEqual(['a.png', 'b.png'])
  expect(view.container.querySelector('[contenteditable="true"]')).toBeInTheDocument()
  expect(api.onChatExternalSendReady).not.toHaveBeenCalled()
  expect(api.rememberChatLastRoute).not.toHaveBeenCalled()
  expect(send).not.toHaveBeenCalled()
  expect(create).not.toHaveBeenCalled()
  expect(window.location.hash).toBe('#floating-chat')
  await act(async () => {
    window.history.replaceState(null, '', '#chat/notes')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
  expect(screen.getByRole('button', { name: '会话列表' })).toBeInTheDocument()
  expect(api.onChatExternalSendReady).not.toHaveBeenCalled()
})


it('opens history only after ownership is granted and keeps pin/capture actions in the small window', async () => {
  setupCaptureTransport()
  const recent = { id: 'conv_old', title: 'Review', provider_id: 'p', model: 'm', created_at: 1, updated_at: 1, revision: 2 }
  vi.spyOn(chatApi, 'getConversations').mockResolvedValue([{ ...recent, preview: '', message_count: 1 }])
  const read = vi.spyOn(chatApi, 'getConversation').mockResolvedValue({ ...recent, messages: [{ id: 'q', role: 'user', content: 'Earlier question', timestamp: 1 }] })
  const claim = vi.spyOn(chatApi, 'claimFloatingConversation').mockRejectedValueOnce(new Error('Already popped out')).mockResolvedValue(undefined)
  const pin = vi.spyOn(chatApi, 'setWindowPinned').mockRejectedValueOnce(new Error('denied')).mockResolvedValue(undefined)
  const capture = vi.spyOn(chatApi, 'captureForFloatingWindow').mockResolvedValue(undefined)
  window.history.replaceState(null, '', '#floating-chat')
  render(<App />)
  const pinButton = await screen.findByRole('button', { name: '窗口置顶' }, { timeout: 8000 })
  await act(async () => { fireEvent.click(pinButton) })
  expect(pinButton).toHaveAttribute('aria-pressed', 'false')
  await act(async () => { fireEvent.click(pinButton) })
  expect(pinButton).toHaveAttribute('aria-pressed', 'true')
  expect(pin.mock.calls).toEqual([[true], [true]])
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '截屏并添加到草稿' })) })
  expect(capture).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '会话列表' }))
  const item = await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Review' })
  await act(async () => { fireEvent.click(item) })
  expect(read).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await act(async () => { fireEvent.click(item) })
  expect(await screen.findByText('Earlier question', {}, { timeout: 8000 })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '新建聊天' }))
  await waitFor(() => expect(screen.queryByText('Earlier question')).not.toBeInTheDocument())
  expect(claim.mock.calls).toEqual([['conv_old'], ['conv_old'], [null]])
  expect(window.location.hash).toBe('#floating-chat')
  expect(api.onChatExternalSendReady).not.toHaveBeenCalled()
})

it('submits an explicit first send with both staged images once', async () => {
  const { create, send } = setupCaptureTransport()
  transport.take.mockResolvedValueOnce(['/stage/a.png', '/stage/b.png'])
  const created = { id: 'conv_new', title: 'New', provider_id: 'p', model: 'm', created_at: 1, updated_at: 1, revision: 0, messages: [] }
  create.mockResolvedValue(created)
  vi.spyOn(chatApi, 'getConversation').mockResolvedValue(created)
  send.mockResolvedValue({ ...created, revision: 1, messages: [{ id: 'reply', role: 'assistant', content: 'Compared both images.', timestamp: 2 }] })
  window.history.replaceState(null, '', '#floating-chat')
  render(<App />)
  await waitFor(() => expect(getComposerDraft(draftKey(null))?.attachments).toHaveLength(2), { timeout: 8000 })
  const editor = document.querySelector('[contenteditable="true"]')!
  await act(async () => { fireEvent.keyDown(editor, { key: 'Enter' }) })
  expect(await screen.findByText('Compared both images.', {}, { timeout: 8000 })).toBeInTheDocument()
  expect(create).toHaveBeenCalledTimes(1)
  expect(send).toHaveBeenCalledTimes(1)
  expect(send.mock.calls[0][0]).toBe(created.id)
  expect(send.mock.calls[0][2]?.map(image => image.path)).toEqual(['/stage/a.png', '/stage/b.png'])
  expect(api.onChatExternalSendReady).not.toHaveBeenCalled()
})
