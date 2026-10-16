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
