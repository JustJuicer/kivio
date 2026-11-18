import { act, render, waitFor, fireEvent, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { chatApi } from './api'
import { api } from '../api/tauri'
import Chat from './Chat'
import { draftKey, getComposerDraft, setComposerDraft } from './composerDraft'

vi.mock('@xterm/xterm', () => ({ Terminal: class {} }))
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class {} }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onFocusChanged: async () => () => {} }) }))
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

it('drains on mount, opens a fresh composer from a center and appends later captures without sending', async () => {
  const { wake, send, create } = setupCaptureTransport()
  transport.take.mockResolvedValueOnce(['/stage/a.png']).mockResolvedValueOnce(['/stage/b.png', '/stage/a.png'])
  window.history.replaceState(null, '', '#chat/notes')
  const enter = vi.fn()
  window.addEventListener('kivio:enter-floating-chat', enter)
  const view = render(<Chat onSettingsChange={() => {}} />)
  try {
    await waitFor(() => expect(enter).toHaveBeenCalledTimes(1))
    expect(window.location.hash).toBe('#chat')
    const key = draftKey(null)
    const first = getComposerDraft(key)!
    expect(first.attachments.map(a => a.name)).toEqual(['a.png'])
    await act(async () => { setComposerDraft(key, { ...first, input: 'compare', quotes: ['reference'] }) })
    await act(async () => { wake(); wake() })
    await waitFor(() => expect(getComposerDraft(key)?.attachments.map(a => a.path)).toEqual(['/stage/a.png', '/stage/b.png']))
    expect(getComposerDraft(key)).toMatchObject({ input: 'compare', quotes: ['reference'] })
    expect(view.container.querySelector('[contenteditable="true"]')?.textContent).toContain('compare')
    expect(enter).toHaveBeenCalledTimes(2)
    expect(create).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  } finally { window.removeEventListener('kivio:enter-floating-chat', enter); view.unmount() }
})

it.each([false, true])('keeps ownership of an open conversation draft (already floating: %s)', async floating => {
  const { wake, send, create } = setupCaptureTransport()
  const id = 'old-conversation'
  vi.spyOn(api, 'chatSyncState').mockResolvedValue(undefined)
  vi.spyOn(chatApi, 'getConversationWindow').mockResolvedValue({ id, title: id, provider_id: '', model: '',
    created_at: 1, updated_at: 1, revision: 1, messages: [{ id: 'old-q', role: 'user', content: 'prior question', timestamp: 1 }] })
  setComposerDraft(id, { input: 'original draft', quotes: [], attachments: [] })
  window.history.replaceState(null, '', `#chat/${id}`)
  const view = render(<Chat onSettingsChange={() => {}} />)
  try {
    await screen.findByText('prior question', {}, { timeout: 8000 })
    if (floating) {
      fireEvent.click(await screen.findByRole('button', { name: '悬浮聊天' }))
      await screen.findByRole('button', { name: '恢复主界面' })
    }
    transport.take.mockResolvedValueOnce(['C:\\stage\\capture.png'])
    await act(async () => { wake() })
    await screen.findByRole('button', { name: '恢复主界面' })
    const target = getComposerDraft(floating ? id : draftKey(null))
    expect(target?.attachments.map(a => a.name)).toEqual(['capture.png'])
    expect(getComposerDraft(id)?.input).toBe('original draft')
    expect(window.location.hash).toBe(floating ? `#chat/${id}` : '#chat')
    if (!floating) expect(getComposerDraft(id)?.attachments).toEqual([])
    expect(create).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  } finally { view.unmount(); setComposerDraft(id, { input: '', quotes: [], attachments: [] }) }
})
