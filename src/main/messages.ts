// All user-visible Korean strings live here. Keep exports additive: one named export per area.

export const mcpMessages = {
  harnessName: {
    claude: 'Claude Code',
    'claude-desktop': 'Claude Desktop',
    codex: 'Codex',
  },
  registerFailed: (name: string, detail: string) => `${name}에 피그마 연결 항목을 등록하지 못했습니다: ${detail}`,
  brokenJson: (file: string) => `설정 파일이 올바른 JSON이 아니어서 건드리지 않았습니다: ${file}`,
  unexpectedJson: (file: string) => `설정 파일의 형식이 예상과 달라서 건드리지 않았습니다: ${file}`,
  cliMissing: (name: string) => `${name} 명령을 찾지 못했습니다.`,
  cliFailed: (name: string, detail: string) => `${name} 명령이 실패했습니다: ${detail}`,
  removeFailed: (detail: string) => `일부 AI 도구에서 피그마 연결 항목을 제거하지 못했습니다: ${detail}`,
}

export const pluginMessages = {
  already: '피그마 플러그인이 이미 연결되어 있습니다.',
  noRelay: '중계 서버가 켜져 있지 않아 플러그인을 연결할 수 없습니다.',
  noFigma: '피그마 데스크톱 앱이 설치되어 있지 않습니다. figma.com/downloads 에서 설치해 주세요.',
  noWindow: '피그마 창이 나타나지 않았습니다. 피그마에서 디자인 파일을 하나 연 뒤 다시 연결해 주세요.',
  noFocus: '피그마 창을 앞으로 가져오지 못했습니다. 피그마 창을 한 번 누른 뒤 다시 연결해 주세요.',
  focusLost: '입력 도중 다른 창으로 포커스가 옮겨져 중단했습니다. 다시 연결해 주세요.',
  quickAction: '퀵 액션으로 플러그인을 실행했습니다.',
  runLast: '마지막 플러그인 재실행으로 플러그인을 연결했습니다.',
  needsInstall:
    '플러그인을 자동으로 실행하지 못했습니다. 피그마에 열린 플러그인 페이지에서 Run을 한 번 눌러 설치하고, 디자인 파일을 연 상태에서 다시 연결해 주세요.',
}

export const doctorMessages = {
  relayLabel: '중계 서버',
  relayOk: (port: number) => `127.0.0.1:${port} 응답`,
  relayDown: '꺼져 있음',
  relayHint: '켜기 또는 고치기가 중계 서버를 켭니다.',
  figmaLabel: '피그마 앱',
  figmaOk: '설치됨 · 실행 중',
  figmaStopped: '설치됨 · 실행 중 아님',
  figmaStoppedHint: '플러그인을 쓰려면 피그마를 켜야 합니다.',
  figmaMissing: '미설치',
  figmaMissingHint: 'https://www.figma.com/downloads/ 에서 데스크톱 앱을 설치하세요.',
  pluginLabel: '피그마 플러그인',
  pluginOk: '중계 서버에 붙어 있습니다',
  pluginMissing: '아직 안 붙음',
  pluginHint: '피그마에서 디자인 파일을 연 상태여야 합니다. 고치기를 누르면 창을 앞으로 꺼내 플러그인을 대신 켭니다.',
  harnessOk: '설치됨 · 피그마 연결 항목 등록됨',
  harnessUnregistered: '앱은 있으나 TalkToFigma 미등록',
  harnessMissing: '미설치',
  anyLabel: 'AI 도구',
  anyMissing: 'Claude Code, Codex, Claude Desktop 이 없습니다',
  anyHint:
    '고치기를 누르면 Claude Code 를 winget 또는 공식 설치 스크립트로 설치합니다. 설치 뒤 로그인은 직접 하셔야 합니다.',
  fixRelay: '중계 서버를 켰습니다.',
  fixFigma: '피그마를 실행했습니다.',
  fixPlugin: '플러그인 연결을 시도했습니다.',
  fixHarness: 'AI 도구의 피그마 연결 항목을 다시 썼습니다.',
  fixFailed: (id: string, detail: string) => `고침 실패 (${id}): ${detail}`,
}

export const harnessInstallMessages = {
  already: (name: string) => `${name} 은 이미 설치돼 있습니다.`,
  viaWinget: (name: string, note: string) => `${name} 을 winget 으로 설치했습니다. ${note}`,
  viaScript: (name: string, note: string) => `${name} 을 공식 설치 스크립트로 설치했습니다. ${note}`,
  failed: (name: string, tried: string[], manualUrl: string) =>
    `${name} 을 자동으로 설치하지 못했습니다 (시도: ${tried.join(', ')}). 회사 네트워크나 백신이 막았을 수 있습니다. ${manualUrl} 에서 직접 설치하세요.`,
  scriptLabel: '공식 설치 스크립트',
  notInstalled: (name: string) => `${name} 이 아직 설치되지 않았습니다.`,
  desktopLogin: 'Claude Desktop 을 열고 로그인하세요.',
  loginOpened: (note: string) => `로그인 창을 열었습니다. ${note}`,
  claudeLoginNote: '터미널에서 claude 를 실행하면 브라우저로 로그인합니다.',
  codexLoginNote: '터미널에서 codex login 을 실행하면 브라우저로 로그인합니다.',
  desktopLoginNote: '앱을 열고 로그인하면 됩니다.',
}

export const aiDoctorMessages = {
  noTool: '로컬 AI 도구(Claude Code 또는 Codex)가 없어 AI 점검을 맡길 수 없습니다.',
  fallbackPrompt: '피그마 연결을 고치세요. 허용된 결정론 명령만 사용하세요.',
}

export const bridgeMessages = {
  portInUse: (port: number) =>
    `${port} 포트를 다른 프로그램이 쓰고 있어 중계 서버를 켜지 못했습니다. 그 프로그램(예: 이전 버전의 피그마 연결)을 끈 뒤 다시 켜 주세요.`,
  relayFailed: (detail: string) => `중계 서버를 켜지 못했습니다: ${detail}`,
  mcpPartial: (errors: string[]) => `일부 AI 도구에 등록하지 못했습니다: ${errors.join(' / ')}`,
  attachFailed: (detail: string) => `플러그인을 연결하는 중 오류가 났습니다: ${detail}`,
  actionFailed: (detail: string) => `작업 중 오류가 났습니다: ${detail}`,
}

export const systemMessages = {
  timedOut: (ms: number) => `명령이 ${Math.round(ms / 1000)}초 안에 끝나지 않아 중단했습니다.`,
}

export const viewMessages = {
  offHeadline: '꺼져 있습니다',
  offDetail: '연동을 누르면 중계 서버를 켜고 피그마 플러그인을 연결합니다.',
  relayOnlyHeadline: '중계는 켜졌지만 아직 연결되지 않았습니다',
  relayOnlyDetail: '피그마에서 디자인 파일을 연 상태로 아래 버튼을 눌러 플러그인을 연결하세요.',
  relayOnlyFigmaStopped: '피그마가 실행 중이 아닙니다. 아래 버튼을 누르면 피그마를 켜고 플러그인을 연결합니다.',
  relayOnlyFigmaMissing: '피그마 데스크톱 앱이 설치되어 있지 않습니다. figma.com/downloads 에서 설치해 주세요.',
  connectedHeadline: '연결됨',
  connectedDetail: '피그마와 AI 도구가 연결되어 있습니다.',
  turnOn: '연동',
  turnOff: '끄기',
  attachPlugin: '플러그인 연결',
  turningOn: '연동 중…',
  turningOff: '끄는 중…',
  attaching: '연결 중…',
}

export const trayMessages = {
  tooltip: {
    off: '피그마 연결: 꺼짐',
    'relay-only': '피그마 연결: 플러그인 미연결',
    connected: '피그마 연결: 연결됨',
  },
  statusLine: {
    off: '꺼짐',
    'relay-only': '중계 켜짐 · 플러그인 미연결',
    connected: '연결됨',
  },
  turnOn: '켜기',
  turnOff: '끄기',
  attachPlugin: '플러그인 연결',
  open: '창 열기',
  quit: '종료',
}

export const appMessages = {
  windowTitle: '피그마 연결',
  updateAvailable: (version: string) => `새 버전 ${version}이 있습니다.`,
  updateDownloading: (progress: number) => `새 버전을 내려받는 중입니다 (${Math.round(progress)}%).`,
  updateReady: '새 버전을 내려받았습니다. 재시작하면 설치됩니다.',
  updateUpToDate: '최신 버전입니다.',
  updateChecking: '업데이트를 확인하는 중입니다.',
  updateError: (detail: string) => `업데이트를 확인하지 못했습니다: ${detail}`,
  updateUnsupported: '개발 중이거나 설치되지 않은 실행이라 자동 업데이트를 쓸 수 없습니다.',
  updateCheck: '업데이트 확인',
  updateDownload: '내려받기',
  updateInstall: '재시작하고 설치',
  settingsTitle: '설정',
  launchAtLogin: 'Windows 로그인 시 자동 시작',
  launchAtLoginHint: '켜 두어도 피그마를 실행하거나 플러그인을 붙이지 않습니다. 트레이에서 조용히 시작합니다.',
  doctorTitle: '점검과 AI 도구',
  doctorRun: '점검',
  doctorFix: '고치기',
  doctorAi: 'AI에게 점검 맡기기',
  doctorRunning: '점검하는 중…',
  doctorAllOk: '모든 항목이 정상입니다.',
  doctorAiRunning: 'AI가 점검하는 중입니다. 몇 분 걸릴 수 있습니다…',
  doctorAiDone: (harness: string, code: number) => `${harness} 점검이 끝났습니다 (종료 코드 ${code}).`,
  installTitle: 'AI 도구 설치',
  install: '설치',
  login: '로그인',
  installing: '설치하는 중…',
  installed: '설치됨',
  notInstalled: '미설치',
  statusOk: '정상',
  statusWarn: '확인 필요',
  statusFail: '문제',
  errorPrefix: '오류: ',
}

export const cliMessages = {
  relayStartTimeout: '앱을 시작했지만 중계 서버가 응답하지 않았습니다. 3055 포트를 다른 프로그램이 쓰고 있는지 확인하세요.',
  cleanupFailed: (detail: string) => `연결 항목을 모두 정리하지 못했습니다: ${detail}`,
}
