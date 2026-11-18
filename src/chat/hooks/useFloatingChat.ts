import { useCallback, useEffect, useRef, useState } from 'react'
import { notifyError } from '../../components/appNoticeStore'
import { chatApi } from '../api'
import { suspendNormalChatGeometry } from '../persistence'

/** Geometry and pin changes affect the same native window. Commit the chrome only on success. */
export function useFloatingChat(errorLabel: string, ready: () => Promise<void>) {
  const [floating, setFloating] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [busy, setBusy] = useState(false)
  const releaseGeometry = useRef<(() => void) | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      releaseGeometry.current?.()
      releaseGeometry.current = null
    }
  }, [])
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
      if (enabled) {
        await ready() // normal placement must finish restoring before native takes its snapshot
        if (!mounted.current) return
        releaseGeometry.current = suspendNormalChatGeometry()
      }
      try {
        await chatApi.setFloatingMode(enabled)
      } catch (error) {
        if (enabled) { releaseGeometry.current?.(); releaseGeometry.current = null }
        throw error
      }
      if (!enabled) { releaseGeometry.current?.(); releaseGeometry.current = null }
      setFloating(enabled)
      if (!enabled) setPinned(false) // Restoring the native placement also removes topmost.
    })
  }, [changeWindow, floating, ready])
  const togglePin = () => changeWindow(async () => {
    await chatApi.setWindowPinned(!pinned)
    setPinned(!pinned)
  })
  return { floating, busy, pinned, changeMode, togglePin }
}
