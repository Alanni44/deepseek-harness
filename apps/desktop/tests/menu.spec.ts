import { describe, expect, it, vi } from 'vitest'
import { createDesktopMenus, type MenuItemLike, type MenuTemplate, type TrayLike } from '../src/main/menu.ts'

function findItem(template: MenuTemplate, label: string): MenuItemLike | undefined {
  for (const item of template) {
    if (item.label === label) return item
    if (item.submenu !== undefined) {
      const nested = findItem(item.submenu, label)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

describe('desktop menus', () => {
  it('creates a restorable tray with the required product commands', () => {
    const listeners = new Map<string, () => void>()
    const setToolTip = vi.fn((_text: string) => undefined)
    const setContextMenu = vi.fn((_menu: unknown) => undefined)
    const tray: TrayLike = {
      setToolTip,
      setContextMenu,
      on: vi.fn((event: 'click', listener: () => void) => { listeners.set(event, listener) }),
      destroy: vi.fn(),
    }
    const show = vi.fn()
    const commands = {
      show,
      checkForUpdates: vi.fn(async () => undefined),
      exportDiagnostics: vi.fn(async () => undefined),
      quit: vi.fn(async () => undefined),
    }
    const setApplicationMenu = vi.fn((_menu: unknown) => undefined)
    const result = createDesktopMenus({
      productName: 'DeepSeek Harness',
      desktopVersion: '0.1.0-rc.7',
      trayImage: 'tray.png',
      commands,
      buildMenu: (template: MenuTemplate) => template,
      setApplicationMenu,
      createTray: () => tray,
    })

    expect(result.tray).toBe(tray)
    expect(setToolTip).toHaveBeenCalledWith('DeepSeek Harness 0.1.0-rc.7')
    const trayTemplate = setContextMenu.mock.calls[0]?.[0] as MenuTemplate
    expect(trayTemplate.map(item => item.label ?? item.type)).toEqual([
      'Show', 'Check for Updates', 'Export Diagnostics', 'separator', 'Quit',
    ])
    listeners.get('click')?.()
    expect(show).toHaveBeenCalledOnce()
    expect(findItem(setApplicationMenu.mock.calls[0]?.[0] as MenuTemplate, 'Quit')?.accelerator).toBe('Ctrl+Q')
  })

  it('retains the application Quit command when tray creation fails', () => {
    const onTrayError = vi.fn((_error: Error) => undefined)
    const setApplicationMenu = vi.fn((_menu: unknown) => undefined)
    const result = createDesktopMenus({
      productName: 'DeepSeek Harness',
      desktopVersion: '0.1.0-rc.7',
      trayImage: 'tray.png',
      commands: {
        show: vi.fn(),
        checkForUpdates: vi.fn(async () => undefined),
        exportDiagnostics: vi.fn(async () => undefined),
        quit: vi.fn(async () => undefined),
      },
      buildMenu: (template: MenuTemplate) => template,
      setApplicationMenu,
      createTray: () => { throw new Error('tray unavailable') },
      onTrayError,
    })

    expect(result.tray).toBeUndefined()
    expect(onTrayError).toHaveBeenCalledWith(expect.objectContaining({ message: 'tray unavailable' }))
    expect(findItem(setApplicationMenu.mock.calls[0]?.[0] as MenuTemplate, 'Quit')).toBeDefined()
  })
})
