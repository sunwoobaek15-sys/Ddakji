# CODEMATE

> **Your AI coding partner.**
> 내 스마트폰 안에서 AI 코딩 파트너 **CLAUDE**가 노트북을 들고 따라다니며, 나와 함께 코딩하는 웹 게임.

스마트폰 내부처럼 생긴 디지털 세계를 걸어 다니면, 작은 노트북을 든 파트너가 따라옵니다.
Code Lab에 들어가 코드를 입력하면 파트너가 옆에서 실시간으로 분석합니다. 오타, 문법 오류, 안 쓰는 변수, 반복 코드를 찾아 알려 주고,
수정안을 보여 준 뒤 **플레이어가 직접 버튼을 눌렀을 때만** 적용합니다. 코드를 실행하면 결과에 맞춰 반응하고, 오류가 나면 몇 번째 줄이 문제인지 설명합니다.

## 실행 방법

설치할 것은 **없습니다**. npm 패키지 의존성이 하나도 없습니다.

```bash
# 1) 가장 간단한 방법: Node 18+ 로 서버 실행
npm start              # = node server/server.js
# → http://localhost:3000  (같은 Wi-Fi의 폰/태블릿은 터미널에 표시되는 http://192.168.x.x:3000)

# 2) 온라인 AI 모드 (Claude API). API 키는 서버 환경 변수에만 둡니다.
ANTHROPIC_API_KEY=sk-ant-... npm start

# 3) 서버 없이: index.html 을 브라우저로 바로 열어도 오프라인 분석기 모드로 플레이할 수 있습니다.
```

| 환경 변수 | 설명 | 기본값 |
|---|---|---|
| `ANTHROPIC_API_KEY` | 설정하면 ONLINE AI MODE (서버에서만 사용, 브라우저로 전송되지 않음) | 없음 → OFFLINE |
| `CODEMATE_MODEL` | 사용할 Claude 모델 | `claude-opus-5-5` |
| `CODEMATE_EFFORT` | 응답 깊이 (`low`/`medium`/`high`…) | `low` (게임 대화용으로 빠르게) |
| `CODEMATE_AI_PROVIDER` | `anthropic` / `mock` (테스트용 가짜 AI) | 키가 있으면 `anthropic` |
| `CODEMATE_RATE_PER_MIN` | IP당 분당 AI 요청 제한 | 30 |
| `PORT`, `HOST` | 서버 주소 | 3000, 0.0.0.0 |

## 조작

| | PC | 모바일 |
|---|---|---|
| 이동 | WASD / 방향키 / 바닥 클릭 | 가상 조이스틱 / 바닥 탭 |
| 방 열기 | 방 안에서 **E**, Enter, Space | **OPEN** 버튼 |
| 앱 | 하단 독(Dock) 아이콘 | 하단 독 아이콘 |
| 뒤로 / 홈 | Esc, ‹, ⌂ | ‹, ⌂, 안드로이드 뒤로가기 |
| 코드 실행 / 저장 | Ctrl+Enter / Ctrl+S | ▶ RUN / 자동 저장 |
| 개발자 모드 | F1 | Settings → DEV MODE |

모바일 Code Lab은 화면을 **Code / AI / Run** 탭으로 나눕니다. 키보드가 올라오면 `{ } ( ) ; =` 같은 기호 키 줄이 함께 나타납니다.

## 게임 구성

- **Home 세계**: Code Lab, AI Room, Settings, Files, Projects, Terminal 방이 있습니다. 파트너는 부드럽게 따라오고, 벽을 돌아서 오며(브레드크럼 추적과 시야 판정), 멀어지면 빨라지고 가까우면 멈춥니다.
- **Code Lab**: 파일 목록, 에디터(문법 강조, 줄 번호, 오류 줄 표시, 자동 들여쓰기), AI Assistant 패널(파트너, 이슈 카드, 채팅), 콘솔과 미리보기.
- **실시간 분석**: 입력을 멈추고 300~800ms 뒤에(설정에서 조절) 로컬에서 분석합니다. 결과 분류는 `TYPO`, `SYNTAX_ERROR`, `UNUSED_VARIABLE`, `DUPLICATED_CODE`, `POSSIBLE_BUG`, `STYLE`, `SIMPLIFICATION`, `GOOD_CODE`, `SUCCESS` 입니다.
- **수정 제안**: FIX, REMOVE/KEEP, APPLY/NO THANKS 버튼과 Before/After 미리보기를 보여 줍니다. 확신이 낮으면 "I might be wrong." 이라고 표시합니다. 코드는 몰래 바꾸지 않습니다.
- **실행**: sandbox iframe 안에서 실행합니다(`allow-scripts`만 허용하고, CSP로 네트워크를 차단합니다). 반복문마다 무한 루프 가드가 들어가고, 오류의 파일과 줄을 찾아 설명합니다.
- **미션 6개**: 플레이어 이동, 적 생성, 점수, 체력바, 추적, 충돌로 만드는 게임입니다. HINT는 3단계로 나눠 알려 주고, CHECK로 실제 테스트를 돌려 채점합니다.
- **성장**: XP와 레벨, 스킬 4종, 업적 14개가 있습니다. 파트너의 말투는 진행에 따라 달라집니다("Let's start with something simple." → "You're getting faster." → "You don't need me to explain that anymore."). 어디까지나 게임 연출입니다.
- **프로젝트**: 템플릿 5종(My First Game, Space Game, Platform Game, Mini RPG, Blank)이 있고 새로 만들기, 열기, 이름 변경, 삭제, 내보내기/가져오기(JSON), 완성 표시(+100 XP)를 지원합니다.
- **저장**: localStorage에 버전이 붙은 JSON 하나로 저장하고 백업본을 둡니다. 불러올 때 모든 값을 검증하고, 손상되면 백업에서 복구합니다.

## 구조

```
index.html              단일 페이지 (클래식 스크립트 → file:// 로도 실행 가능)
css/style.css           스마트폰 OS 스타일 UI, 반응형/모바일 우선
js/config.js            설정 (파트너 이름 PARTNER_NAME 등)
js/analyzer.js          로컬 분석기: acorn AST + 스코프 분석 + 괄호/따옴표 스캐너 (Node에서도 테스트)
js/brain.js             오프라인 파트너 두뇌: 오류 설명, 규칙 기반 대화
js/aiService.js         AIService: analyzeCode / deepAnalyze / explainError / suggestFix / chat
js/partner.js           파트너 캐릭터: 10가지 상태 + 말풍선 + 캔버스 드로잉
js/world.js             세계, 충돌, 카메라, 따라오기 AI
js/sandbox.js           코드 실행 샌드박스
js/editor.js            코드 에디터 (textarea + 하이라이트 레이어)
js/chat.js, js/ui.js, js/phone.js, js/storage.js, js/progress.js, js/content.js, js/devtools.js, js/main.js
js/apps/*.js            Code Lab, Files, Projects, Terminal, AI Room, Settings
js/vendor/acorn.js      JavaScript 파서 (MIT, 유일한 외부 코드)
server/server.js        의존성 없는 Node 서버: 정적 파일 + /api
server/ai/providers.js  AI Provider 추상화 (Anthropic / Mock) — 교체 가능
server/ai/prompts.js    파트너 프롬프트와 JSON 스키마
tests/                  단위 테스트 + 브라우저 E2E 테스트
```

`Game Client → Backend API (/api/ai/*) → AI Provider` 구조입니다. AI 연결이 실패하면 "AI connection unavailable." 을 띄우고 로컬 분석기로 바로 넘어갑니다.

## 테스트

```bash
npm test          # 분석기 + 서버 + AI Provider 단위 테스트 (node:test)
npm run test:e2e  # 실제 Chromium으로 PC/모바일/온라인/장애 시나리오 (Playwright 필요)
```
