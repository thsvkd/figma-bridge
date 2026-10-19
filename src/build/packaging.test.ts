import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM script without type declarations
import { extractStatusJson, isPackagedExecutable } from '../../script/smoke-packaged.mjs'

const read = (path: string) => readFileSync(path, 'utf8')
const yaml = (path: string) => load(read(path)) as Record<string, any>

describe('electron-builder.yml', () => {
  const cfg = yaml('electron-builder.yml')

  it('identifies the app and publishes to GitHub releases', () => {
    expect(cfg.appId).toBe('com.figma-bridge.app')
    expect(cfg.productName).toBe('피그마 연결')
    expect(cfg.publish).toEqual({ provider: 'github', owner: 'thsvkd', repo: 'figma-bridge' })
  })

  it('packages from an allow list and unpacks what must run outside the asar', () => {
    expect(cfg.files).toEqual(['out/**', 'resources/**', 'package.json'])
    expect(cfg.asarUnpack).toEqual(['resources/**', '**/node_modules/**/*'])
    expect(cfg.npmRebuild).toBe(false)
  })

  it('builds a per-user one-click NSIS x64 installer only', () => {
    expect(cfg.win.target).toEqual([{ target: 'nsis', arch: ['x64'] }])
    expect(cfg.nsis).toMatchObject({
      oneClick: true,
      perMachine: false,
      allowElevation: false,
      artifactName: '${name}-${version}-setup.${ext}',
      createDesktopShortcut: 'always',
      differentialPackage: true,
    })
    expect(cfg.directories.output ?? 'dist').toBe('dist')
  })

  it('does not sign the build', () => {
    expect(JSON.stringify(cfg)).not.toMatch(/certificate|signingHash|signtoolOptions/i)
  })

  it('wires the custom NSIS include', () => {
    expect(cfg.nsis.include).toBe('build/installer.nsh')
  })
})

describe('build/installer.nsh', () => {
  const nsh = read('build/installer.nsh')

  it('removes the MCP entries through the app on uninstall', () => {
    expect(nsh).toMatch(/!macro customUnInstall/)
    expect(nsh).toContain('ExecWait \'"$INSTDIR\\${APP_EXECUTABLE_FILENAME}" --cleanup\'')
  })

  it('asks before deleting runtime data and only then removes it', () => {
    expect(nsh).toMatch(/MessageBox MB_YESNO/)
    expect(nsh).toMatch(/IDYES|IDNO/)
    expect(nsh).toContain(String.raw`$LOCALAPPDATA\FigmaBridge`)
    expect(nsh).toContain('${ifNot} ${isUpdated}')
    expect(nsh).toMatch(/RMDir \/r/)
  })
})

describe('workflows', () => {
  it('ci runs typecheck and tests on windows and is reusable', () => {
    const ci = yaml('.github/workflows/ci.yml')
    expect(ci.on).toHaveProperty('workflow_call')
    const text = read('.github/workflows/ci.yml')
    expect(text).toContain('windows-latest')
    expect(text).toContain('npm ci')
    expect(text).toContain('npm run typecheck')
    expect(text).toContain('npm test')
  })

  it('release is tag triggered, checks the version and publishes the three assets', () => {
    const rel = yaml('.github/workflows/release.yml')
    expect(rel.on.push.tags).toEqual(['v*'])
    const text = read('.github/workflows/release.yml')
    expect(text).toContain("t!=='v'+v")
    expect(text).toContain('npm run build')
    expect(text).toContain('npx electron-builder --win --x64 --publish never')
    expect(text).toContain('softprops/action-gh-release')
    for (const asset of ['*-setup.exe', '*-setup.exe.blockmap', 'latest.yml']) {
      expect(text).toContain(asset)
    }
    expect(text).not.toMatch(/macos|ubuntu-latest\s*\n\s*target/)
  })
})

describe('package.json scripts', () => {
  const scripts = JSON.parse(read('package.json')).scripts
  it('exposes the packaging entry points', () => {
    expect(scripts['build:win']).toBe('npm run build && electron-builder --win --x64')
    expect(scripts['smoke:packaged']).toBe('node script/smoke-packaged.mjs')
  })
})

describe('smoke-packaged helpers', () => {
  it('extracts the status JSON from output with logging noise around it', () => {
    const out = '[1016/1:00] noise\n{\n  "version": "1.0.0",\n  "switchOn": false\n}\ntrailing log\n'
    expect(extractStatusJson(out)).toEqual({ version: '1.0.0', switchOn: false })
  })

  it('throws when no JSON object is present', () => {
    expect(() => extractStatusJson('nothing here')).toThrow(/JSON/)
  })

  it('only accepts the unpacked windows executable', () => {
    expect(isPackagedExecutable('C:/x/dist/win-unpacked/figma-bridge.exe')).toBe(true)
    expect(isPackagedExecutable('C:/x/dist/win-unpacked/resources/elevate.exe')).toBe(false)
    expect(isPackagedExecutable('C:/x/dist/figma-bridge-1.0.0-setup.exe')).toBe(false)
  })
})
