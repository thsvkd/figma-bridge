# 피그마 연결

Windows에서 **Talk to Figma MCP**(로컬, 무료)로 Claude Code / Codex와 피그마 데스크톱 앱을 붙이는 설치기·관리 앱입니다. 터미널을 몰라도 더블클릭으로 씁니다.

## 설치

1. `설치.cmd` 를 더블클릭합니다. 관리자 권한은 필요 없습니다.
2. 바탕화면 또는 시작 메뉴의 **피그마 연결** 을 엽니다.
3. 피그마에서 디자인 파일을 하나 열어 둡니다.
4. **연결** 을 누릅니다. 여기서 끝입니다.

피그마를 시킬 AI 가 이 PC 에 하나는 있어야 합니다. 없으면 **AI 도구 설치** 를 누르세요.
winget 으로 먼저 시도하고, 안 되면 공식 설치 스크립트로 물러섭니다. 관리자 권한은 필요 없습니다.

| | winget 장치 ID | 설치 안 될 때 |
|---|---|---|
| Claude Code (권장) | `Anthropic.ClaudeCode` | https://docs.claude.com/en/docs/claude-code/setup |
| Codex CLI | `OpenAI.Codex` | https://developers.openai.com/codex/cli |
| Claude Desktop | `Anthropic.Claude` | https://claude.ai/download |

**로그인은 대신 해 드릴 수 없습니다.** 설치가 끝나면 같은 창의 **로그인** 버튼이 터미널을 열어 주고,
거기서 각자 계정으로 로그인하시면 됩니다. 이 터미널만은 일부러 보이게 띄웁니다.

**연결** 버튼 하나가 이만큼을 합니다.

- Bun · Talk to Figma MCP 고정 버전 준비
- 중계 서버(127.0.0.1:3055) 실행
- Claude Code / Claude Desktop / Codex 에 MCP 항목 등록
- 피그마 앱 실행 → 창을 앞으로 꺼내 퀵 액션(Ctrl+/)으로 플러그인 실행
- 플러그인이 아직 없으면 설치 페이지를 피그마 앱 안에서 열어 줌

플러그인이 붙었는지는 GUI 의 **피그마 플러그인** 줄이 직접 알려 줍니다. 로그를 읽어 짐작하지 않고 중계 서버에 물어봅니다.

플러그인: https://www.figma.com/community/plugin/1485687494525374295/talk-to-figma-mcp-plugin

## 채널 이름은 신경 쓰지 않아도 됩니다

플러그인은 열 때마다 임의의 채널 이름을 만듭니다. 원래는 그 이름을 읽어서 AI에게 불러 줘야 했습니다.
이 앱의 중계 서버(`lib/relay.js`)는 채널이 달라도 플러그인과 AI 를 서로 이어 줍니다.
AI 에게는 그냥 "피그마 보여?" 라고 물으면 됩니다.

## 창이 뜨지 않습니다

바로가기는 `wscript.exe App.vbs` 로 GUI 만 띄웁니다. 중계 서버와 설치 작업도 콘솔 창 없이 돌아갑니다.
터미널에서 직접 쓰고 싶으면 `App.cmd -Action status` 처럼 CLI 를 쓰면 됩니다.

## 관리

- **연결 / 연결 해제 / 새로고침 / 점검**
- 점검이 결정론적으로 못 고치면 **AI에게 점검 맡기기** (로컬 Claude Code 또는 Codex)

제거: `Uninstall.cmd`

런타임과 로그는 `%LOCALAPPDATA%\FigmaBridge` 에 둡니다. 이 레포는 설치 원본입니다.
