# 피그마 연결 Electron 설치판과 OTA 구현 계획

> **For agentic workers:** 사용자가 실행 방식을 이미 정했다. **Workflow 도구로 태스크를 오케스트레이션하고, 아래 태스크별 모델 등급(Model)대로 서브에이전트를 라우팅한다.** 작성 에이전트와 검토 에이전트는 분리한다. 각 태스크는 작성 후 별도의 `oh-my-claudecode:code-reviewer`(opus)가 검토하고, 마지막에 `oh-my-claudecode:verifier`가 전체를 검증한다. 단계는 체크박스(`- [ ]`)로 추적한다. 실행 전 `workflow-authoring` 스킬을 읽는다.

**Goal:** PowerShell 기반 피그마 연결을 Electron 앱으로 옮기고, GitHub Release의 `setup.exe`와 OTA 업데이트로 배포하며, 연동 버튼 하나와 켜기/끄기 스위치로 동작하게 만든다.

**Architecture:** 주입 가능한 경계(Relay, McpRegistry, FigmaDriver, PluginLauncher, BridgeController, UpdateManager)를 main 프로세스에 두고, 피그마 조작과 파일 시스템과 네트워크는 가짜로 교체해 테스트한다. 렌더러는 상태 하나와 명령 몇 개만 preload를 통해 본다. 중계 서버는 앱 프로세스 안에서 `ws`로 돌고, MCP 서버는 앱 실행 파일을 `ELECTRON_RUN_AS_NODE=1`로 호출해 번들된 패키지를 실행한다.

**Tech Stack:** TypeScript, Electron, electron-vite, electron-builder(NSIS), electron-updater, vitest, `ws`, `koffi`(Win32 FFI), 바닐라 TS 렌더러.

**Spec:** `docs/superpowers/specs/2026-10-16-electron-installer-ota-design.md`

## Global Constraints

- 운영체제는 Windows 10 이상 64비트만 지원한다. 관리자 권한을 요구하지 않는다(`nsis.perMachine: false`, `oneClick: true`, `allowElevation: false`).
- 중계 서버는 `127.0.0.1:3055`이고 포트를 바꿀 수 없다. 플러그인과 AI 도구를 구분하는 규칙은 기존 `lib/relay.js`의 `clientKind`와 같다(Origin 헤더가 있거나 User-Agent에 `figma|electron|mozilla`가 있으면 플러그인).
- MCP 항목 이름은 `TalkToFigma`, 패키지는 `cursor-talk-to-figma-mcp` 고정 버전 `0.3.5`이고 앱에 번들한다.
- 플러그인 이름은 `Talk To Figma MCP Plugin`, 설치 페이지는 `https://www.figma.com/community/plugin/1485687494525374295/talk-to-figma-mcp-plugin`이다.
- 런타임 데이터와 로그는 `%LOCALAPPDATA%\FigmaBridge`에 두고, 환경 변수 `FIGMA_BRIDGE_HOME`이 있으면 그 경로를 쓴다.
- 업데이트: publish provider `github`(owner `thsvkd`, repo `figma-bridge`), `autoDownload=false`, `autoInstallOnAppQuit=false`, 시작할 때 한 번 확인, 다운로드와 설치는 사용자가 누를 때 진행한다.
- 릴리스는 `v*` 태그가 트리거하고, 태그와 `package.json` 버전이 다르면 실패한다. 자산은 `*-setup.exe`, `*-setup.exe.blockmap`, `latest.yml`이다.
- 복원(앱 시작, 로그인 자동 시작, 업데이트 후 재시작)은 피그마 실행, 창 앞으로 가져오기, 키 입력을 **0회** 수행한다. 플러그인 붙이기는 사용자가 누를 때만 한다.
- 끄기는 MCP 항목을 건드리지 않는다. MCP 항목 제거는 설치 프로그램의 제거 단계(`--cleanup`)에서만 한다.
- 로그인 자동 시작 기본값은 꺼짐이다. 코드 서명은 하지 않는다.
- 사용자에게 보이는 문구는 한국어다. 코드 식별자와 코드 주석은 영어, 한국어 문구는 `src/main/messages.ts` 한 곳에 모은다.

## Review Focus

스펙이 암시하지만 어느 태스크의 기본 테스트에도 없는 입력이나 실패 상황이다. 각 항목의 테스트는 소유 태스크에 들어 있다.

1. 3055 포트를 다른 프로그램이 쓰고 있다: 켜기가 원인을 한국어로 알리고 실패하며, 스위치 값을 켜짐으로 저장하지 않는다. (Task 6)
2. 연동 버튼을 연타하거나 더블클릭한다: 플러그인 붙이기가 동시에 둘 돌지 않고 키 입력이 한 번만 나간다. (Task 5)
3. `claude_desktop_config.json`이 깨진 JSON이거나 BOM이 있거나 비어 있다: 덮어써서 사용자 설정을 잃지 않는다. 백업 후 실패를 보고하거나 BOM을 허용해 읽는다. (Task 3)
4. 사용자 이름이 한글이거나 경로에 공백이 있다(`C:\Users\홍 길동\...`): 앱 경로가 JSON, TOML, CLI 인자에서 깨지지 않고 되읽힌다. (Task 3)
5. 업데이트 확인 중 오프라인이거나 GitHub가 응답하지 않는다: 앱 시작과 연동이 막히지 않고, 오류 상태로 표시되며 다시 확인할 수 있다. (Task 7)

## 파일 구조

```
package.json, tsconfig.json, tsconfig.node.json, tsconfig.web.json
electron.vite.config.ts, vitest.config.ts, electron-builder.yml, build/installer.nsh
.github/workflows/ci.yml, release.yml
resources/icon.png, build/icon.ico
src/shared/types.ts           BridgeState, UpdateState 등 공유 타입, IPC 채널 이름
src/main/messages.ts          한국어 문구
src/main/paths.ts             경로 규칙(createPaths)
src/main/settings.ts          SettingsStore
src/main/relay/Relay.ts       중계 서버
src/main/mcp/launch.ts        MCP 실행 명령(McpLaunch) 만들기
src/main/mcp/McpRegistry.ts   Claude Code, Claude Desktop, Codex 항목 관리
src/main/figma/FigmaDriver.ts 인터페이스와 Win32(koffi) 구현
src/main/figma/PluginLauncher.ts
src/main/bridge/BridgeController.ts
src/main/update/UpdateManager.ts
src/main/doctor/{Doctor,harnessInstall,aiDoctor}.ts
src/main/{index,window,tray,ipc,cli}.ts
src/preload/index.ts
src/renderer/index.html, src/renderer/src/{main.ts,viewModel.ts,styles.css}
tests/ 는 두지 않고 소스 옆 *.test.ts 로 둔다.
docs/manual-checklist.md      실제 피그마 수동 검증표
```

---

### Task 1: 스캐폴드와 설정 저장소

**Model:** sonnet

**Files:**
- Create: `package.json`(name `figma-bridge`, version `1.0.0`, main `./out/main/index.js`, 의존성 `ws`, `electron-updater`, `koffi`, `cursor-talk-to-figma-mcp@0.3.5`, 개발 의존성 `electron`, `electron-vite`, `electron-builder`, `vitest`, `typescript`, `@types/ws`, `@types/node`), `tsconfig*.json`, `electron.vite.config.ts`, `vitest.config.ts`, `.gitignore`(기존 항목 + `out/`, `dist/`), `src/shared/types.ts`, `src/main/paths.ts`, `src/main/settings.ts`
- Test: `src/main/paths.test.ts`, `src/main/settings.test.ts`

**Interfaces:**
- Produces: `createPaths(env?: NodeJS.ProcessEnv): Paths` 와 `interface Paths { home: string; logDir: string; settingsFile: string; claudeJson: string; claudeDesktopConfig: string; codexConfig: string; figmaCandidates: string[] }`
- Produces: `interface Settings { switchOn: boolean; launchAtLogin: boolean }`, `class SettingsStore { constructor(file: string); get(): Settings; set(patch: Partial<Settings>): Settings }`
- Produces: `shared/types.ts`의 `BridgeStatus = 'off' | 'relay-only' | 'connected'`, `HarnessId = 'claude' | 'claude-desktop' | 'codex'`, `interface HarnessState { id: HarnessId; name: string; installed: boolean; registered: boolean }`, `interface BridgeState { switchOn: boolean; status: BridgeStatus; busy: boolean; figmaInstalled: boolean; figmaRunning: boolean; harness: HarnessState[]; message?: string }`, `UpdateStatus`/`UpdateState`(ftp-browser의 `src/shared/types/update.ts`에서 `autoUpdate` 필드만 뺀 것)

- [ ] **Step 1: 실패하는 테스트.** `paths.test.ts`: `createPaths({LOCALAPPDATA:'C:\\L', APPDATA:'C:\\A', USERPROFILE:'C:\\U'}).home === 'C:\\L\\FigmaBridge'`, `FIGMA_BRIDGE_HOME`이 있으면 그 값이 `home`이다, `claudeJson === 'C:\\U\\.claude.json'`, `claudeDesktopConfig === 'C:\\A\\Claude\\claude_desktop_config.json'`, `codexConfig === 'C:\\U\\.codex\\config.toml'`. `settings.test.ts`: 파일이 없으면 `{switchOn:false, launchAtLogin:false}`, `set`이 저장 후 새 인스턴스로 읽어도 유지, 알 수 없는 필드를 무시하고 없는 필드는 기본값, 깨진 JSON이면 기본값을 돌려주고 파일을 덮어쓰지 않는다.
- [ ] **Step 2: 실행해서 실패 확인.** `npx vitest run src/main/paths.test.ts src/main/settings.test.ts` → FAIL(모듈 없음)
- [ ] **Step 3: 구현.** 위 시그니처대로 `paths.ts`, `settings.ts`, `shared/types.ts`를 만든다. `package.json` 스크립트는 ftp-browser와 같은 이름(`dev`, `build`, `test`, `typecheck`)을 쓴다. 설정 파일 쓰기는 임시 파일에 쓴 뒤 rename한다.
- [ ] **Step 4: 통과 확인.** `npm install` 후 위 명령 → PASS, `npm run typecheck` → 오류 없음
- [ ] **Step 5: 커밋.** `git add -A && git commit -m "feat: scaffold Electron app with paths and settings store"`

### Task 2: 중계 서버 (Relay)

**Model:** sonnet

**Files:**
- Create: `src/main/relay/Relay.ts`
- Test: `src/main/relay/Relay.test.ts`

**Interfaces:**
- Consumes: `lib/relay.js`의 프로토콜(`join`, `message`, `progress_update`, 채널 바꿔 끼우기, `GET /status`, OPTIONS CORS)을 동일하게 옮긴다.
- Produces: `interface RelayStatus { relay: 'figma-bridge'; ok: true; port: number; startedAt: string; figma: number; harness: number; figmaJoined: number; harnessJoined: number; ready: boolean; channels: string[] }`, `class Relay { constructor(opts: { port: number; log?: (line: string) => void }); start(): Promise<void>; stop(): Promise<void>; status(): RelayStatus; get running(): boolean }`, `class PortInUseError extends Error { port: number }`

- [ ] **Step 1: 실패하는 테스트.** 포트는 테스트마다 빈 포트를 쓴다. `tests/relay-check.js`의 시나리오를 vitest로 옮긴다: (a) 하네스(Origin 없음)와 플러그인(`origin: 'null'`)이 서로 다른 채널로 join해도 명령이 플러그인에, 결과가 하네스에 전달되고 `broadcast`의 `channel`이 받는 쪽 채널이다, (b) `status()`와 HTTP `GET /status` 값이 같고 `figmaJoined===1`, `harnessJoined===1`, `ready===true`, (c) `start()`를 두 번 불러도 서버는 하나이고 두 번째는 즉시 resolve, (d) 같은 포트를 `net.createServer`가 점유 중이면 `start()`가 `PortInUseError`로 reject, (e) `stop()` 후 `running===false`이고 `stop()`을 다시 불러도 오류가 없다.
- [ ] **Step 2: 실패 확인.** `npx vitest run src/main/relay` → FAIL
- [ ] **Step 3: 구현.** `http.createServer`에 `ws`의 `WebSocketServer({ server })`를 붙이고 `127.0.0.1`에만 바인딩한다. `EADDRINUSE`는 `PortInUseError`로 바꾼다.
- [ ] **Step 4: 통과 확인.** 같은 명령 → PASS
- [ ] **Step 5: 커밋.** `git commit -m "feat: port relay server to ws"`

### Task 3: MCP 등록 (McpRegistry)

**Model:** opus (경로 인용과 파일 손상 방지 같은 모서리 상황이 많다)

**Files:**
- Create: `src/main/mcp/launch.ts`, `src/main/mcp/McpRegistry.ts`
- Test: `src/main/mcp/launch.test.ts`, `src/main/mcp/McpRegistry.test.ts`

**Interfaces:**
- Consumes: `Paths`(Task 1)
- Produces: `interface McpLaunch { command: string; args: string[]; env: Record<string, string> }`, `buildLaunch(opts: { exePath: string; resourcesPath: string }): McpLaunch`(command는 `exePath`, args는 `[<resources>/app.asar.unpacked/node_modules/cursor-talk-to-figma-mcp/dist/server.js]`, env는 `{ ELECTRON_RUN_AS_NODE: '1' }`)
- Produces: `interface HarnessTarget { id: HarnessId; name: string; isInstalled(): boolean; isRegistered(l: McpLaunch): Promise<boolean>; register(l: McpLaunch): Promise<void>; unregister(): Promise<void> }`, `createTargets(deps: { paths: Paths; runCli: (file: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>; findCommand: (name: 'claude' | 'codex') => string | null; fs?: typeof import('node:fs/promises') }): HarnessTarget[]`
- Produces: `class McpRegistry { constructor(targets: HarnessTarget[]); ensure(l: McpLaunch): Promise<Array<{ id: HarnessId; changed: boolean; error?: string }>>; removeAll(): Promise<void>; list(l: McpLaunch): Promise<HarnessState[]> }`

- [ ] **Step 1: 실패하는 테스트.**
  - `ensure`: 대상이 설치되어 있고 이미 같은 launch로 등록돼 있으면 `register`가 호출되지 않고 `changed:false`. 두 번 연속 호출하면 두 번째는 모두 `changed:false`. 등록된 경로가 다르면(앱이 이동/업데이트) 다시 등록한다. 설치되지 않은 대상은 건너뛴다. 한 대상이 throw해도 다른 대상은 계속하고 `error`에 한국어 사유를 담는다.
  - Claude Desktop JSON: 항목이 없으면 `mcpServers.TalkToFigma`만 추가하고 **다른 서버 항목과 다른 최상위 키를 그대로 보존**한다. 쓰기 전에 `%LOCALAPPDATA%\FigmaBridge\backups`에 백업한다. BOM이 있는 파일을 읽을 수 있다. 깨진 JSON이면 파일을 바꾸지 않고 `register`가 오류를 throw한다(Review Focus 3).
  - Codex TOML: 마커 블록(`# >>> figma-bridge TalkToFigma >>>` ... `# <<< figma-bridge TalkToFigma <<<`)을 쓰고, 같은 블록이 있으면 교체하며 블록 밖 내용은 보존한다. `env = { ELECTRON_RUN_AS_NODE = "1" }`를 포함한다. 두 번 호출해도 블록이 하나다. `unregister`는 마커 블록만 제거한다.
  - Claude Code: `isRegistered`는 `~/.claude.json`의 `mcpServers.TalkToFigma`의 command, args, env를 읽어 비교하고, `register`는 `claude mcp remove`(실패 무시) 후 `claude mcp add --scope user --transport stdio -e ELECTRON_RUN_AS_NODE=1 TalkToFigma -- <command> <args...>`를 `runCli`로 호출한다.
  - 한글과 공백 경로(`C:\Users\홍 길동\AppData\Local\Programs\figma-bridge\figma-bridge.exe`)가 JSON, TOML 쓰기 후 되읽기에서 같고, CLI 인자는 배열로 전달된다(Review Focus 4).
- [ ] **Step 2: 실패 확인.** `npx vitest run src/main/mcp` → FAIL
- [ ] **Step 3: 구현.** 기존 `lib/Harness.ps1`의 동작을 기준으로 한다(파일 경로, 마커, 백업). 모든 파일 쓰기는 읽기-수정-쓰기를 하고, 파싱 실패 시 쓰지 않는다.
- [ ] **Step 4: 통과 확인.** 같은 명령 → PASS
- [ ] **Step 5: 번들 MCP 서버 확인(수동).** `npm install` 후 `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe node_modules/cursor-talk-to-figma-mcp/dist/server.js`가 오류 없이 stdin 대기하는지 확인한다. 의존성 누락이면 `electron-builder.yml`의 `asarUnpack`에 필요한 패키지를 더하는 것을 Task 10에 기록한다.
- [ ] **Step 6: 커밋.** `git commit -m "feat: idempotent MCP registration for Claude Code, Desktop and Codex"`

### Task 4: FigmaDriver와 Win32 구현

**Model:** opus (FFI와 포커스 동작은 가장 불안정한 부분이다)

**Files:**
- Create: `src/main/figma/FigmaDriver.ts`, `src/main/figma/win32.ts`
- Test: `src/main/figma/win32.test.ts`

**Interfaces:**
- Consumes: `Paths.figmaCandidates`(Task 1)
- Produces:
  ```ts
  export interface FigmaDriver {
    isInstalled(): boolean
    isRunning(): Promise<boolean>
    launch(): Promise<void>                       // 실행 중이 아닐 때만 실제로 실행
    waitForWindow(timeoutMs: number): Promise<boolean>
    focus(): Promise<boolean>                     // 앞으로 가져오고 실제로 포그라운드가 됐는지 반환
    isFigmaForeground(): boolean
    sendQuickAction(pluginName: string): Promise<void>  // Esc, Ctrl+/, 유니코드 입력, Enter
    sendRunLast(): Promise<void>                  // Esc, Ctrl+Alt+P
    openPluginPage(url: string): Promise<void>    // 피그마 앱으로 URL을 연다
    captureForeground(): number                   // 포그라운드 창 핸들
    restoreForeground(handle: number): void
  }
  export function createWin32FigmaDriver(deps: { figmaPath: () => string | null; spawn: typeof import('node:child_process').spawn; listFigmaPids: () => Promise<number[]> }): FigmaDriver
  ```
- Produces: 순수 함수 `parseTasklistCsv(csv: string): number[]`(`tasklist /FI "IMAGENAME eq Figma.exe" /FO CSV /NH` 출력에서 PID 목록), `buildUnicodeKeyInputs(text: string): Array<{ wScan: number; flags: number }>`(KEYEVENTF_UNICODE 키 다운/업 쌍)

- [ ] **Step 1: 실패하는 테스트(순수 부분만).** `parseTasklistCsv`: 정상 출력에서 PID들을 뽑고, `INFO: No tasks are running...`이면 빈 배열. `buildUnicodeKeyInputs('Talk To')`: 문자당 down/up 두 개이고 `wScan`이 UTF-16 코드 유닛이다(한글 IME에 영향받지 않게 유니코드 입력을 쓰는 이유다). 피그마 경로 후보 중 존재하는 첫 번째를 고르는 `createWin32FigmaDriver().isInstalled()`를 가짜 `figmaPath`로 검증한다.
- [ ] **Step 2: 실패 확인.** `npx vitest run src/main/figma/win32` → FAIL
- [ ] **Step 3: 구현.** `koffi`로 `user32`의 `EnumWindows`, `GetWindowThreadProcessId`, `IsWindowVisible`, `IsIconic`, `ShowWindow`, `SetForegroundWindow`, `GetForegroundWindow`, `AttachThreadInput`, `SendInput`을 바인딩한다. 창 선택은 PID가 피그마 프로세스이고 보이는 최상위 창 중 가장 큰 것이다. `focus()`는 최소화를 풀고 `SetForegroundWindow`를 시도하며 실패하면 `AttachThreadInput`으로 한 번 더 시도하고, 폴링(25ms 간격, 상한 1000ms)으로 포그라운드 확인 후 `boolean`을 반환한다. `send*`는 포그라운드 확인 후 `SendInput`으로 보내고, 키 사이에는 고정 대기 대신 가능한 한 이벤트가 처리될 만큼의 짧은 폴링 지연(최대 몇 십 ms)만 둔다. 퀵 액션 창이 뜨는 데 필요한 대기는 실측해서 상수로 `figma/timings.ts`에 모은다.
- [ ] **Step 4: 통과 확인.** 같은 명령 → PASS. 이어서 수동으로 `docs/manual-checklist.md`의 "Win32 스모크"(Task 11)를 실행해 실제 피그마에서 포커스와 퀵 액션이 동작함을 확인한다.
- [ ] **Step 5: 커밋.** `git commit -m "feat: Win32 Figma driver with unicode key input"`

### Task 5: PluginLauncher

**Model:** opus

**Files:**
- Create: `src/main/figma/PluginLauncher.ts`
- Test: `src/main/figma/PluginLauncher.test.ts`, 테스트용 가짜 `src/main/figma/fakeDriver.ts`

**Interfaces:**
- Consumes: `FigmaDriver`(Task 4), `RelayStatus`(Task 2)
- Produces:
  ```ts
  export type LaunchOutcome = 'already' | 'quick-action' | 'run-last' | 'needs-install' | 'no-figma' | 'no-focus' | 'no-relay'
  export interface LaunchResult { outcome: LaunchOutcome; detail: string }
  export class PluginLauncher {
    constructor(deps: { driver: FigmaDriver; relayStatus: () => RelayStatus | null; pluginName: string; pluginUrl: string; sleep?: (ms: number) => Promise<void>; timeouts?: { window: number; attach: number; poll: number } })
    attach(): Promise<LaunchResult>   // 동시에 여러 번 불러도 같은 Promise를 돌려준다
  }
  ```

- [ ] **Step 1: 실패하는 테스트.** 가짜 `FigmaDriver`가 호출을 기록한다.
  - `already`: `figmaJoined>0`이면 `launch`, `focus`, `send*`가 모두 0회이다.
  - `no-relay`: `relayStatus()`가 null이면 입력 0회.
  - `no-figma`: `isInstalled()`가 false이면 입력 0회.
  - 실행 중이 아니면 `launch` 후 `waitForWindow`를 기다리고, 창이 안 나타나면 `no-focus`가 아니라 실패 사유와 함께 끝난다.
  - `quick-action`: 가짜가 `sendQuickAction` 호출 뒤 `figmaJoined`를 1로 올리면 그 결과로 끝나고 `sendRunLast`는 0회이다.
  - `run-last`: 퀵 액션으로 안 붙고 재실행으로 붙는 경우.
  - `needs-install`: 둘 다 안 붙으면 `openPluginPage(pluginUrl)`을 1회 호출하고 `needs-install`이다. 이어서 같은 가짜에서 플러그인이 붙은 상태로 `attach()`를 다시 부르면 `already`이고 입력 0회(설치 전후 멱등).
  - `no-focus`: `focus()`가 두 번 실패하면 `send*` 0회이다. 입력 도중 `isFigmaForeground()`가 false가 되면 이후 입력을 보내지 않고 실패한다.
  - 모든 경우에 `captureForeground`로 저장한 핸들을 `restoreForeground`에 돌려주고(입력을 보내지 않은 `already`는 캡처도 하지 않는다), 도중에 throw해도 복원한다.
  - 동시 호출: `attach()`를 세 번 동시에 불러도 `sendQuickAction`은 최대 1회이고 모두 같은 결과를 받는다(Review Focus 2).
- [ ] **Step 2: 실패 확인.** `npx vitest run src/main/figma/PluginLauncher` → FAIL
- [ ] **Step 3: 구현.** 스펙 5.3의 1~7단계를 그대로 따른다. 대기는 `waitUntil(cond, timeoutMs, intervalMs)` 폴링 헬퍼 하나로 통일하고 `sleep`은 주입받는다. 기본 상한은 `timings.ts`의 값을 쓴다.
- [ ] **Step 4: 통과 확인.** 같은 명령 → PASS
- [ ] **Step 5: 커밋.** `git commit -m "feat: idempotent plugin launcher with focus restore"`

### Task 6: BridgeController

**Model:** opus

**Files:**
- Create: `src/main/bridge/BridgeController.ts`, `src/main/messages.ts`
- Test: `src/main/bridge/BridgeController.test.ts`

**Interfaces:**
- Consumes: `Relay`(Task 2), `McpRegistry`+`McpLaunch`(Task 3), `PluginLauncher`(Task 5), `SettingsStore`(Task 1), `BridgeState`(Task 1)
- Produces:
  ```ts
  export class BridgeController {
    constructor(deps: { relay: Pick<Relay,'start'|'stop'|'status'|'running'>; registry: Pick<McpRegistry,'ensure'|'list'>; launch: () => McpLaunch; launcher: Pick<PluginLauncher,'attach'>; settings: SettingsStore; env: { figmaInstalled(): boolean; figmaRunning(): Promise<boolean> }; emit: (s: BridgeState) => void })
    getState(): BridgeState
    turnOn(): Promise<BridgeState>        // 사용자 동작: 중계, MCP, 플러그인 붙이기
    restore(): Promise<BridgeState>       // 앱 시작과 업데이트 후: 중계, MCP까지만
    turnOff(): Promise<BridgeState>
    attachPlugin(): Promise<BridgeState>  // '중계 켜짐, 플러그인 미연결' 상태의 버튼
    refresh(): Promise<BridgeState>       // /status를 읽어 상태 갱신, 폴링에서 호출
  }
  ```

- [ ] **Step 1: 실패하는 테스트.**
  - `status` 도출: 스위치 꺼짐 → `off`, 중계 동작 + 플러그인 미연결 → `relay-only`, 플러그인 연결 → `connected`. 플러그인이 끊기면 `refresh()`가 `relay-only`로 되돌린다.
  - `turnOn`: 순서가 relay.start → registry.ensure → launcher.attach이고, 스위치 값이 `true`로 저장된다. 이미 켜져 있고 연결된 상태에서 다시 부르면 `relay.start`는 no-op, `ensure`는 `changed:false`, `attach`는 `already`이며 결과 상태가 같다(멱등).
  - `restore`: 저장된 값이 켜짐이면 relay.start와 ensure만 호출하고 **`launcher.attach`는 0회**이다. 저장된 값이 꺼짐이면 아무것도 하지 않는다. 플러그인이 안 붙었으면 `relay-only`이다.
  - `turnOff`: relay.stop을 호출하고 값을 `false`로 저장하며 `registry`는 건드리지 않는다. 끄기와 켜기를 3회 반복해도 결과가 같다.
  - 포트 점유: `relay.start`가 `PortInUseError`면 상태 `off`, `message`에 한국어 원인, 스위치 값은 **저장하지 않는다**(Review Focus 1).
  - `ensure`가 일부 대상에서 오류를 돌려줘도 `turnOn`은 계속 진행하고 `message`에 요약한다. 모든 전이마다 `emit`이 호출되고 진행 중에는 `busy:true`이다. 같은 동작이 동시에 두 번 호출되면 한 번만 실행한다.
- [ ] **Step 2: 실패 확인.** `npx vitest run src/main/bridge` → FAIL
- [ ] **Step 3: 구현.** `messages.ts`에 문구를 모은다. `busy` 동안 들어온 같은 동작은 진행 중인 Promise를 돌려준다.
- [ ] **Step 4: 통과 확인.** 같은 명령 → PASS
- [ ] **Step 5: 커밋.** `git commit -m "feat: bridge controller with on, off and restore"`

### Task 7: UpdateManager

**Model:** sonnet

**Files:**
- Create: `src/main/update/UpdateManager.ts`
- Test: `src/main/update/UpdateManager.test.ts`

**Interfaces:**
- Consumes: `UpdateState`(Task 1). 구조는 ftp-browser의 `src/main/update/UpdateManager.ts`를 따르되 `autoUpdate` 관련 로직을 모두 뺀다.
- Produces: `interface UpdateClient`(ftp-browser와 같은 모양에서 `on`, `checkForUpdates`, `downloadUpdate`, `quitAndInstall`과 `autoDownload`, `autoInstallOnAppQuit` 속성), `isAutomaticUpdateSupported(o: { isPackaged: boolean; platform: string; isSmokeTest: boolean }): boolean`, `class UpdateManager { constructor(currentVersion: string, updater: UpdateClient | null, emit: (s: UpdateState) => void); getState(); check(): Promise<UpdateState>; download(): Promise<UpdateState>; install(): void }`

- [ ] **Step 1: 실패하는 테스트.** 지원되지 않으면 `updater===null`이고 상태가 `unsupported`이며 명령은 아무 일도 하지 않는다. 생성자가 `autoDownload=false`, `autoInstallOnAppQuit=false`로 설정한다. `check()`가 `checking` → `update-available`로 `available`, `update-not-available`로 `up-to-date`가 된다. `ready`/`downloading`/`checking` 상태에서는 `check()`가 `checkForUpdates`를 부르지 않는다(함정 C). `error` 이벤트와 `checkForUpdates` rejection이 모두 `error` 상태가 되고 이후 `check()`로 다시 확인할 수 있다(함정 B, Review Focus 5). `download()`는 `available`에서만 동작하고 `update-downloaded`로 `ready`가 되며, `install()`은 `ready`에서만 `quitAndInstall(false, true)`를 부른다.
- [ ] **Step 2: 실패 확인.** `npx vitest run src/main/update` → FAIL
- [ ] **Step 3: 구현.** ftp-browser 코드를 참고해 위 요구대로 작성한다.
- [ ] **Step 4: 통과 확인.** 같은 명령 → PASS
- [ ] **Step 5: 커밋.** `git commit -m "feat: update manager for OTA"`

### Task 8: 점검(Doctor), AI 도구 설치, AI 점검

**Model:** sonnet

**Files:**
- Create: `src/main/doctor/Doctor.ts`, `src/main/doctor/harnessInstall.ts`, `src/main/doctor/aiDoctor.ts`, `resources/ai-doctor.md`(기존 `prompts/ai-doctor.md`를 새 CLI 기준으로 고친 것)
- Test: `src/main/doctor/Doctor.test.ts`, `src/main/doctor/harnessInstall.test.ts`

**Interfaces:**
- Consumes: `McpRegistry.list`, `Relay.status`, `FigmaDriver.isInstalled/isRunning`, `BridgeController.attachPlugin`
- Produces: `interface Check { id: string; label: string; status: 'ok' | 'warn' | 'fail'; text: string; hint?: string; fixId?: 'start-relay' | 'start-figma' | 'attach-plugin' | 'connect-harness' | 'install-harness' }`, `class Doctor { constructor(deps); run(opts?: { fix?: boolean }): Promise<{ checks: Check[]; applied: string[]; ok: boolean }> }`
- Produces: `getHarnessCatalog(): HarnessCatalogEntry[]`(기존 `lib/HarnessInstall.ps1`의 Claude Code, Codex CLI, Claude Desktop 항목: winget ID `Anthropic.ClaudeCode`/`OpenAI.Codex`/`Anthropic.Claude`, 스크립트 URL, 수동 URL, 로그인 안내), `installHarness(id: HarnessId, deps: { findCommand; runProcess; download }): Promise<{ ok: boolean; method: 'already' | 'winget' | 'script' | 'none'; needsLogin: boolean; detail: string; manualUrl: string }>`, `startHarnessLogin(id, deps)`, `runAiDoctor(...)`

- [ ] **Step 1: 실패하는 테스트.** Doctor: 중계 꺼짐이면 `start-relay`가 `fail`, 피그마 미설치면 안내 힌트, 플러그인 미연결이면 `warn`과 `attach-plugin`, 각 도구 설치됨+미등록이면 `fail`+`connect-harness`, 도구가 하나도 없으면 `install-harness`. `run({fix:true})`가 같은 fixId를 한 번만 실행하고, 이미 정상인 상태에서 두 번 돌려도 `applied`가 비어 있다(멱등). installHarness: 이미 있으면 `already`이고 `runProcess` 0회, winget 성공 후 경로가 잡히면 `winget`, winget 실패 시 스크립트로 물러서며(파일로 받아 `-NoProfile -ExecutionPolicy Bypass -File`로 실행), 둘 다 실패하면 `manualUrl`을 포함한 한국어 안내를 돌려준다.
- [ ] **Step 2: 실패 확인.** `npx vitest run src/main/doctor` → FAIL
- [ ] **Step 3: 구현.** 기존 PowerShell 코드의 판정과 문구를 옮긴다. `runAiDoctor`는 설치된 `claude`(우선) 또는 `codex`를 헤드리스로 실행하고, 프롬프트는 진단 번들 JSON 경로와 허용 명령(`<앱 exe> --status`, `<앱 exe> --doctor-fix`)만 안내한다. 출력의 비밀값 마스킹(`Protect-FbSecretText`의 세 규칙)을 옮긴다.
- [ ] **Step 4: 통과 확인.** 같은 명령 → PASS
- [ ] **Step 5: 커밋.** `git commit -m "feat: doctor, harness install and AI doctor"`

### Task 9: 앱 연결(main, preload, 창, 트레이, CLI)과 렌더러

**Model:** sonnet (트레이와 자동 시작 연결은 opus 검토)

**Files:**
- Create: `src/main/index.ts`, `src/main/window.ts`, `src/main/tray.ts`, `src/main/ipc.ts`, `src/main/cli.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.ts`, `src/renderer/src/viewModel.ts`, `src/renderer/src/styles.css`, `resources/icon.png`, `build/icon.ico`
- Test: `src/renderer/src/viewModel.test.ts`, `src/main/cli.test.ts`

**Interfaces:**
- Consumes: Task 1~8의 모든 경계
- Produces: `describeBridge(state: BridgeState): { tone: 'off' | 'warn' | 'ok'; headline: string; detail: string; action: { kind: 'turn-on' | 'attach-plugin' | 'turn-off'; label: string } }`, `parseCliArgs(argv: string[]): { mode: 'gui' | 'cleanup' | 'status' | 'doctor-fix'; hidden: boolean }`
- Produces: preload가 `window.bridge`로 노출하는 API: `getState()`, `turnOn()`, `turnOff()`, `attachPlugin()`, `onState(cb)`, `update.{getState,check,download,install,onState}`, `doctor.{run(fix),ai()}`, `harness.{install(id),login(id)}`, `settings.{get,set}`

- [ ] **Step 1: 실패하는 테스트.** `describeBridge`: `off`는 `tone:'off'`, 액션 `turn-on`(라벨 "연동"), `relay-only`는 `tone:'warn'`이고 헤드라인이 "아직 연결되지 않았습니다"를 포함하며 액션이 `attach-plugin`(라벨 "플러그인 연결"), `connected`는 `tone:'ok'`이고 액션이 `turn-off`. `busy`일 때 액션이 비활성 표시를 위해 `label`에 진행 문구를 쓴다. `parseCliArgs`: `--cleanup`, `--status`, `--doctor-fix`, `--hidden`을 해석하고 알 수 없는 인자는 무시한다.
- [ ] **Step 2: 실패 확인.** `npx vitest run src/renderer src/main/cli` → FAIL
- [ ] **Step 3: 구현.**
  - `index.ts`: `parseCliArgs`가 GUI가 아니면 `requestSingleInstanceLock` 이전에 헤드리스로 처리하고 종료한다(`--cleanup`은 `McpRegistry.removeAll()`, `--status`는 상태 JSON 출력, `--doctor-fix`는 `Doctor.run({fix:true})` 결과 출력). GUI 모드는 단일 인스턴스를 보장하고, 시작 시 `BridgeController.restore()`를 호출하며(**플러그인 붙이기 없음**), `--hidden`이면 창 없이 트레이로 시작한다. 시작 시 업데이트를 한 번 확인하되 실패해도 앱 동작을 막지 않는다. `/status` 폴링(약 1초)으로 `refresh()`를 부른다.
  - 창을 닫으면 숨기고 트레이로 내려간다. 트레이 메뉴: 상태 줄, 켜기/끄기, 플러그인 연결(`relay-only`일 때만), 창 열기, 종료. 트레이 아이콘과 툴팁이 세 상태를 반영한다. 시스템 알림은 쓰지 않는다.
  - 설정 `launchAtLogin`은 `app.setLoginItemSettings({ openAtLogin, args: ['--hidden'] })`와 연결한다.
  - 렌더러(바닐라 TS): 첫 화면에 `describeBridge` 결과(상태 줄, 큰 연동/끄기 스위치, `warn`일 때 눈에 띄는 안내와 "플러그인 연결" 버튼)를 보여 주고, 아래에 업데이트 알림 줄, 설정(자동 시작), 점검과 AI 도구 설치 영역을 둔다. 문구는 `messages.ts`와 일관되게 한국어로 쓴다. 설정 화면을 열 때 `update.getState()`를 다시 읽는다.
- [ ] **Step 4: 통과 확인.** 같은 명령 → PASS, `npm run build` → 성공, `npm run dev`로 창이 뜨고 세 상태가 가짜 값으로 전환되는 것을 눈으로 확인한다.
- [ ] **Step 5: 커밋.** `git commit -m "feat: wire app shell, tray, CLI and renderer"`

### Task 10: 패키징, CI, 릴리스 워크플로

**Model:** sonnet

**Files:**
- Create: `electron-builder.yml`, `build/installer.nsh`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`
- Modify: `package.json`(스크립트 `build:win`, `smoke:packaged`)
- Test: `script/smoke-packaged.mjs`(패키징된 앱을 `--status`로 실행해 JSON이 나오는지 확인)

**Interfaces:**
- Produces: 릴리스 산출물 `figma-bridge-<version>-setup.exe`, `.blockmap`, `latest.yml`

- [ ] **Step 1: 설정 작성.** `electron-builder.yml`은 ftp-browser를 따른다: `appId com.figma-bridge.app`, `productName 피그마 연결`, `publish: {provider: github, owner: thsvkd, repo: figma-bridge}`, `files`는 허용 목록(`out/**`, `resources/**`, `package.json`), `asarUnpack`에 `resources/**`, `**/node_modules/cursor-talk-to-figma-mcp/**/*`, `**/node_modules/koffi/**/*`, `**/node_modules/@koromix/**/*`(Task 3 Step 5에서 확인한 의존성 포함), `win.target nsis x64`만, `nsis: {oneClick: true, perMachine: false, allowElevation: false, artifactName: ${name}-${version}-setup.${ext}, createDesktopShortcut: always, differentialPackage: true}`, `npmRebuild: false`. `build/installer.nsh`의 `customUnInstall` 매크로가 `ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --cleanup'`을 실행한다. 제거 화면의 "런타임 데이터 삭제 여부" 질문은 `MessageBox`로 묻고 예일 때만 `%LOCALAPPDATA%\FigmaBridge`를 지운다.
- [ ] **Step 2: CI.** `ci.yml`은 `windows-latest`에서 `npm ci`, `npm run typecheck`, `npm test`를 돌리고 `workflow_call`도 받는다. `release.yml`은 ftp-browser의 `release.yml`에서 Windows 잡만 남긴 것이다: 태그와 `package.json` 버전 일치 검사, `npm run build`, `npx electron-builder --win --x64 --publish never`, 자산 업로드, `softprops/action-gh-release`로 `*-setup.exe`, `*-setup.exe.blockmap`, `latest.yml`을 게시한다.
- [ ] **Step 3: 로컬 패키징 확인.** `npm run build:win` 성공, `dist/`에 위 세 파일이 있고 `latest.yml`의 파일명과 해시가 일치한다. `node script/smoke-packaged.mjs`가 풀린 앱(`dist/win-unpacked`)에서 `--status`를 실행해 JSON을 받는다.
- [ ] **Step 4: 커밋.** `git commit -m "build: electron-builder NSIS packaging and release workflow"`

### Task 11: 구 구현 제거, 문서, 수동 검증표

**Model:** haiku (문서와 삭제), 수동 검증표 검토는 verifier(sonnet)

**Files:**
- Delete: `App.cmd`, `App.ps1`, `App.vbs`, `Install.ps1`, `Setup.cmd`, `Uninstall.cmd`, `설치.cmd`, `lib/`, `prompts/`, `tests/`, 루트 `package.json`의 구 내용(Task 1에서 대체됨)
- Modify: `README.md`(설치는 Release의 `setup.exe`, SmartScreen 경고 넘기는 방법, 연동 버튼과 스위치, 세 상태 설명, 업데이트 방법), `.gitignore`
- Create: `docs/manual-checklist.md`

- [ ] **Step 1: 새 앱이 구 기능을 모두 대체하는지 대조.** 구 `lib/*.ps1`의 기능 목록(Bun 설치, 중계 서버, 하네스 등록, 플러그인 실행, 점검, AI 점검, AI 도구 설치와 로그인, 바로가기)과 Task 1~10의 대응을 표로 확인하고 빠진 것이 있으면 해당 태스크로 돌아간다.
- [ ] **Step 2: 삭제와 문서.** 위 파일을 `git rm`하고 README를 새로 쓴다.
- [ ] **Step 3: 수동 검증표 작성.** `docs/manual-checklist.md`에 다음 항목을 체크박스로 둔다: Win32 스모크(피그마 창 앞으로, 퀵 액션으로 플러그인 실행, 포커스 복원), **플러그인 설치됨** 상태에서 연동 2회 연속(두 번째는 창이 움직이지 않음), **플러그인 미설치** 상태에서 연동(설치 페이지가 피그마 앱 안에서 열리고, Run 후 다시 연동하면 붙음), 끄기와 켜기 반복, 앱 종료 후 재시작과 로그인 자동 시작에서 피그마가 실행되지 않고 "플러그인 미연결"이 보임, 3055 포트 점유, 업데이트(이전 버전 설치 후 새 릴리스 태그를 올려 알림, 다운로드, 재시작 설치, 복원 확인), **Claude Code가 MCP 자식 프로세스로 앱 exe를 실행 중일 때 업데이트 설치가 되는지**(설치 프로그램이 실행 중 프로세스를 종료하는 동작을 확인하고, 문제가 있으면 MCP 실행용 exe 복사본 방식으로 바꾸는 후속 작업으로 기록), 제거 후 MCP 항목이 사라지는지.
- [ ] **Step 4: 검증.** `npm run typecheck && npm test && npm run build:win` 모두 통과, `git grep -n -E "TODO|test\.skip|\.only\(" -- src docs` 결과 없음.
- [ ] **Step 5: 커밋.** `git commit -m "chore: remove PowerShell implementation, update docs and manual checklist"`

---

## 자체 검토 기록

- **스펙 대응:** 설치 파일/릴리스(Task 10), OTA(Task 7, 9, 10), 연동·켜기·끄기·복원·세 상태(Task 6, 9), 트레이와 자동 시작(Task 9), 플러그인 붙이기 절차와 속도·안정성(Task 4, 5), 멱등성과 설치/미설치 테스트(Task 3, 5, 6), 점검과 AI 도구 설치(Task 8), 제거 시 MCP 정리(Task 9, 10), 수동 검증(Task 11).
- **알려진 위험:** Claude Code가 앱 exe를 MCP 자식 프로세스로 실행 중일 때 NSIS 업데이트가 그 프로세스를 종료하거나 막을 수 있다. Task 11의 수동 검증으로 확인하고, 문제가 있으면 exe 복사본 방식으로 바꾼다.
