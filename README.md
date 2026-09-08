# 피그마 연결

Windows에서 **Talk to Figma MCP**(로컬, 무료)로 Claude Code / Codex와 피그마 데스크톱 앱을 붙이는 설치기·관리 앱입니다. 터미널을 몰라도 더블클릭으로 씁니다.

## 설치

1. `설치.cmd` 를 더블클릭합니다. 관리자 권한은 필요 없습니다.
2. 바탕화면 또는 시작 메뉴의 **피그마 연결** 을 엽니다.
3. **연결** 을 누릅니다.
4. 피그마에서 `Plugins → Talk to Figma MCP Plugin` 을 실행하고, Connect 후 채널 이름 `figma` 로 Join 합니다.

플러그인: https://www.figma.com/community/plugin/1485687494525374295/talk-to-figma-mcp-plugin

## 관리

- **연결 / 연결 해제 / 새로고침 / 점검**
- 점검이 결정론적으로 못 고치면 **AI에게 점검 맡기기** (로컬 Claude Code 또는 Codex)

제거: `Uninstall.cmd`

런타임과 로그는 `%LOCALAPPDATA%\FigmaBridge` 에 둡니다. 이 레포는 설치 원본입니다.
