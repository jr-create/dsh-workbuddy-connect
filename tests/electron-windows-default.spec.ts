import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultWorkBuddyElectronPath } from '../src/desktop-credential-protection.ts'

/**
 * Issue #48 follow-on: the Windows half of the default Electron path.
 *
 * macOS has one verified layout, so its path is a constant. Windows has none:
 * the updater lets the user pick a drive, and the uninstall entry reports no
 * `InstallLocation` to read instead — the app on a real machine sits on `D:`.
 * The default is therefore a probe over the install roots, and these tests pin
 * the three things that can go wrong in a probe: precedence (the per-user
 * install wins over a drive sweep), the drive-relative path bug (`path.join`
 * on a bare `D:` yields `D:Program Files`, which resolves against the current
 * directory), and an honest `undefined` when nothing is installed.
 *
 * `accessSync` is stubbed rather than the filesystem, so the sweep can be
 * pointed at paths that do not exist without touching the real drives.
 */

const { reachable } = vi.hoisted(() => ({ reachable: new Set<string>() }))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    accessSync: (path: string): void => {
      if (!reachable.has(path)) {
        const error: NodeJS.ErrnoException = new Error(`ENOENT: ${path}`)
        error.code = 'ENOENT'
        throw error
      }
    },
  }
})

const ENV_NAMES = ['LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)'] as const
const savedEnv = new Map<string, string | undefined>()
let savedPlatform = process.platform

/** Stub the platform for one test, restoring it afterwards. */
function stubPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

beforeEach(() => {
  reachable.clear()
  savedPlatform = process.platform
  for (const name of ENV_NAMES) savedEnv.set(name, process.env[name])
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: savedPlatform, configurable: true })
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  savedEnv.clear()
})

describe('defaultWorkBuddyElectronPath on Windows', () => {
  it('prefers the per-user install the updater writes', () => {
    const localAppData = 'C:\\Users\\tester\\AppData\\Local'
    process.env['LOCALAPPDATA'] = localAppData
    const installed = `${localAppData}\\Programs\\WorkBuddy\\WorkBuddy.exe`
    reachable.add(installed)
    // A drive-root copy exists too; the env root is probed first.
    reachable.add('C:\\Program Files\\WorkBuddy\\WorkBuddy.exe')
    stubPlatform('win32')
    expect(defaultWorkBuddyElectronPath()).toBe(installed)
  })

  it('finds an install on another drive', () => {
    for (const name of ENV_NAMES) delete process.env[name]
    const installed = 'D:\\Program Files\\WorkBuddy\\WorkBuddy.exe'
    reachable.add(installed)
    stubPlatform('win32')
    expect(defaultWorkBuddyElectronPath()).toBe(installed)
  })

  it('never builds a drive-relative path', () => {
    for (const name of ENV_NAMES) delete process.env[name]
    const installed = 'D:\\Program Files\\WorkBuddy\\WorkBuddy.exe'
    reachable.add(installed)
    stubPlatform('win32')
    const found = defaultWorkBuddyElectronPath()
    expect(found).toBe(installed)
    // `path.join('D:', 'Program Files')` would produce this instead.
    expect(found?.startsWith('D:\\')).toBe(true)
  })

  it('answers undefined when no install is present', () => {
    for (const name of ENV_NAMES) delete process.env[name]
    stubPlatform('win32')
    expect(defaultWorkBuddyElectronPath()).toBeUndefined()
  })

  it('leaves platforms with no confirmed layout unset', () => {
    reachable.add('C:\\Program Files\\WorkBuddy\\WorkBuddy.exe')
    for (const platform of ['linux', 'darwin'] as const) {
      stubPlatform(platform)
      // Linux has no verified layout, so it must not adopt the Windows probe;
      // macOS answers its own constant, never a Windows candidate.
      expect(defaultWorkBuddyElectronPath()).not.toBe('C:\\Program Files\\WorkBuddy\\WorkBuddy.exe')
    }
  })
})
