/** Application and tray menus with a safe no-tray fallback. */

export interface MenuItemLike {
  label?: string
  type?: 'separator'
  accelerator?: string
  submenu?: MenuTemplate
  click?: () => void
}

export type MenuTemplate = MenuItemLike[]

export interface TrayLike {
  setToolTip(text: string): void
  setContextMenu(menu: unknown): void
  on(event: 'click', listener: () => void): void
  destroy(): void
}

export interface DesktopMenuCommands {
  show(): void
  checkForUpdates(): Promise<void>
  exportDiagnostics(): Promise<void>
  quit(): Promise<void>
}

export interface CreateDesktopMenusOptions {
  productName: string
  desktopVersion: string
  trayImage: string
  commands: DesktopMenuCommands
  buildMenu: (template: MenuTemplate) => unknown
  setApplicationMenu: (menu: unknown) => void
  createTray: (image: string) => TrayLike
  onTrayError?: (error: Error) => void
  onCommandError?: (error: Error) => void
}

export interface MenuResult {
  tray?: TrayLike
  applicationMenu: unknown
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function runCommand(command: () => Promise<void>, onError?: (error: Error) => void): void {
  void command().catch((error: unknown) => { onError?.(asError(error)) })
}

function commandTemplate(commands: DesktopMenuCommands, onError?: (error: Error) => void): MenuTemplate {
  return [
    { label: 'Show', click: () => { commands.show() } },
    { label: 'Check for Updates', click: () => { runCommand(() => commands.checkForUpdates(), onError) } },
    { label: 'Export Diagnostics', click: () => { runCommand(() => commands.exportDiagnostics(), onError) } },
    { type: 'separator' },
    { label: 'Quit', accelerator: 'Ctrl+Q', click: () => { runCommand(() => commands.quit(), onError) } },
  ]
}

/** Install an always-available application menu and create the tray if possible. */
export function createDesktopMenus(options: CreateDesktopMenusOptions): MenuResult {
  const commands = commandTemplate(options.commands, options.onCommandError)
  const applicationMenu = options.buildMenu([{ label: 'File', submenu: commands }])
  options.setApplicationMenu(applicationMenu)
  try {
    const tray = options.createTray(options.trayImage)
    tray.setToolTip(`${options.productName} ${options.desktopVersion}`)
    tray.setContextMenu(options.buildMenu(commandTemplate(options.commands, options.onCommandError)))
    tray.on('click', () => { options.commands.show() })
    return { tray, applicationMenu }
  } catch (error) {
    options.onTrayError?.(asError(error))
    return { applicationMenu }
  }
}
