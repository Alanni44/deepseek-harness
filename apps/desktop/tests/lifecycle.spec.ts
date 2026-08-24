import { describe, expect, it, vi } from 'vitest'
import {
  bindApplicationLifecycle,
  bindWindowClose,
  createQuitCoordinator,
  handleWindowClose,
  restoreWindow,
  type CloseEventLike,
  type LifecycleWindowLike,
  type LifecycleAppLike,
} from '../src/main/lifecycle.ts'

describe('desktop lifecycle', () => {
  it('hides on close only when a tray exists', () => {
    expect(handleWindowClose({ isQuitting: false, trayAvailable: true })).toBe('hide')
    expect(handleWindowClose({ isQuitting: false, trayAvailable: false })).toBe('quit')
    expect(handleWindowClose({ isQuitting: true, trayAvailable: true })).toBe('close')
  })

  it('restores, shows, and focuses a hidden or minimized window', () => {
    const window = {
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    }
    restoreWindow(window)
    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })

  it('stops the backend once before clearing health, destroying tray, and quitting', async () => {
    const order: string[] = []
    const coordinator = createQuitCoordinator({
      stopBackend: async () => { order.push('backend:stop') },
      clearActiveRun: () => { order.push('health:clear') },
      destroyTray: () => { order.push('tray:destroy') },
      appQuit: () => { order.push('app:quit') },
    })

    await Promise.all([coordinator.requestQuit('tray'), coordinator.requestQuit('window')])
    expect(coordinator.isQuitting()).toBe(true)
    expect(order).toEqual(['backend:stop', 'health:clear', 'tray:destroy', 'app:quit'])
  })

  it('prevents a close, hides with a tray, and never stops the backend', () => {
    let closeHandler: ((event: CloseEventLike) => void) | undefined
    const hide = vi.fn()
    const window: LifecycleWindowLike = {
      hide,
      on: vi.fn((_event: 'close', listener: (event: CloseEventLike) => void) => { closeHandler = listener }),
    }
    const requestQuit = vi.fn(async () => undefined)
    const coordinator = {
      isQuitting: () => false,
      requestQuit,
      restartToUpdate: vi.fn(async () => undefined),
    }
    const event = { preventDefault: vi.fn() }
    bindWindowClose({ window, coordinator, trayAvailable: () => true })
    closeHandler?.(event)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(hide).toHaveBeenCalledOnce()
    expect(requestQuit).not.toHaveBeenCalled()
  })

  it('stops before invoking the updater installer', async () => {
    const order: string[] = []
    const coordinator = createQuitCoordinator({
      stopBackend: async () => { order.push('backend:stop') },
      clearActiveRun: () => { order.push('health:clear') },
      destroyTray: () => { order.push('tray:destroy') },
      appQuit: () => { order.push('app:quit') },
    })
    await coordinator.restartToUpdate(() => { order.push('update:install') })
    expect(order).toEqual(['backend:stop', 'health:clear', 'tray:destroy', 'update:install'])
  })

  it('routes app quit and Windows session end through the coordinator', () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const app: LifecycleAppLike = {
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => { listeners.set(event, listener) }),
    }
    const requestQuit = vi.fn(async () => undefined)
    const coordinator = {
      isQuitting: () => false,
      requestQuit,
      restartToUpdate: vi.fn(async () => undefined),
    }
    const beforeQuit = { preventDefault: vi.fn() }
    bindApplicationLifecycle(app, coordinator)

    listeners.get('before-quit')?.(beforeQuit)
    listeners.get('query-session-end')?.()

    expect(beforeQuit.preventDefault).toHaveBeenCalledOnce()
    expect(requestQuit).toHaveBeenNthCalledWith(1, 'window')
    expect(requestQuit).toHaveBeenNthCalledWith(2, 'session-end')
  })
})
