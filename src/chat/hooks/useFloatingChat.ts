import { useCallback, useRef, useState } from 'react'
import { notifyError } from '../../components/appNoticeStore'
import { chatApi } from '../api'

/** Geometry and pin changes affect the same native window. Commit the chrome only on success. */
export function useFloatingChat(errorLabel: string) {
  const [floating, setFloating] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const changeWindow = useCallback(async (change: () => Promise<void>) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    try {
      await change()
    } catch (error) {
      notifyError(`${errorLabel}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }, [errorLabel])
  const changeMode = useCallback((enabled: boolean) => {
    if (floating === enabled) return
    return changeWindow(async () => {
      await chatApi.setFloatingMode(enabled)
      setFloating(enabled)
      if (!enabled) setPinned(false) // Restoring the native placement also removes topmost.
    })
  }, [changeWindow, floating])
  const togglePin = () => changeWindow(async () => {
    await chatApi.setWindowPinned(!pinned)
    setPinned(!pinned)
  })
  return { floating, busy, pinned, changeMode, togglePin }
}
