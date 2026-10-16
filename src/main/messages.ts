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
