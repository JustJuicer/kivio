import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SettingsSnapshot } from '../api/tauri'
import { i18n } from '../components/i18n'
import { makeSettings } from './tabs/testFixtures'
import { SettingsShell } from './SettingsShell'

const canonical: SettingsSnapshot = {
  settings: makeSettings({ settingsLanguage: 'zh', chat: { defaultLanguage: 'zh' } as never }),
  version: { epoch: 'test', revision: 1 },
}
const pendingSave = new Promise<SettingsSnapshot>(() => {})

vi.mock('../api/settingsCache', () => ({
  peekSettingsSnapshot: () => canonical,
  getSettingsSnapshotCached: async () => canonical,
  refreshSettingsSnapshot: async () => canonical,
  saveSettingsSnapshotCached: () => pendingSave,
  subscribeSettingsSnapshot: () => () => {},
  importSettingsSnapshotCached: async () => canonical,
  updateSettingsCached: vi.fn(),
}))

vi.mock('../api/tauri', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/tauri')>()
  return {
    ...original,
    api: {
      ...original.api,
      getAppVersion: async () => 'test',
      getDefaultPromptTemplates: async () => ({}),
      listSystemFonts: async () => [],
      getPermissionStatus: async () => ({ platform: 'windows', accessibility: true, screenRecording: true }),
      onHotkeyWarning: async () => () => {},
      onUpdateAvailable: async () => () => {},
      onReplaceTranslationPackProgress: async () => () => {},
    },
  }
})

describe('SettingsShell floating chat shortcut', () => {
  it('shows a Lens conflict in both rows and clears only the floating binding', async () => {
    const user = userEvent.setup()
    const t = i18n.zh
    render(<SettingsShell variant="embedded" initialTab="hotkeys" hideNav onClose={vi.fn()} onSettingsChange={vi.fn()} renderReleaseNotes={() => null} />)
    const floating = within((await screen.findByText(t.floatingChatHotkeyLabel)).closest<HTMLElement>('.kv-row')!)
    const lens = within(screen.getByText(t.lensTabLabel).closest<HTMLElement>('.kv-row')!)
    await user.click(floating.getByRole('button', { name: t.hotkeyRecord }))
    await user.keyboard('{Control>}{Shift>}g{/Shift}{/Control}')
    expect(floating.getByText(t.hotkeyConflictWith.replace('{partner}', t.hotkeyScopeLens))).toBeInTheDocument()
    expect(lens.getByText(t.hotkeyConflictWith.replace('{partner}', t.floatingChatHotkeyLabel))).toBeInTheDocument()
    await user.click(floating.getByRole('button', { name: t.hotkeyClear }))
    expect(floating.queryByText('G')).toBeNull()
    expect(lens.getByText('G')).toBeInTheDocument()
    expect(lens.queryByText(t.hotkeyConflictWith.replace('{partner}', t.floatingChatHotkeyLabel))).toBeNull()
  })
})

describe('SettingsShell session center language slot', () => {
  it('omits retired connector and duplicate plugin settings entries', async () => {
    render(<SettingsShell variant="embedded" onClose={vi.fn()} onSettingsChange={vi.fn()} renderReleaseNotes={() => null} />)
    expect(await screen.findByRole('button', { name: i18n.zh.tabSessions })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '连接器' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '插件' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '插件' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('插件来源')).not.toBeInTheDocument()
  })

  it('renders the unsaved language draft before the canonical snapshot changes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const renderSessionCenter = (lang: 'zh' | 'en') => <p data-testid="session-language">{lang}</p>
    render(
      <SettingsShell
        variant="embedded"
        onClose={onClose}
        onSettingsChange={vi.fn()}
        renderSessionCenter={renderSessionCenter}
        renderReleaseNotes={() => null}
      />,
    )

    await user.click(await screen.findByRole('button', { name: '中文' }))
    await user.click(screen.getByRole('option', { name: 'English' }))
    await user.click(screen.getByRole('button', { name: i18n.en.tabSessions }))

    expect(screen.getByTestId('session-language')).toHaveTextContent('en')
    expect(canonical.settings.settingsLanguage).toBe('zh')
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('session-language')).toHaveTextContent('en')
  })
})
