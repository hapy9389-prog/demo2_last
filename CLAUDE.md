@AGENTS.md
# CLAUDE.md

# Project Overview

이 프로젝트는 Claude API를 사용하는 AI 캐릭터 채팅 웹앱 MVP이다.

현재 Next.js + TypeScript 기반이며 모바일 메신저 형태의 UI를 사용한다.

이 프로젝트의 핵심 목표는 단순한 AI 채팅이 아니라,
캐릭터가 고유한 성격을 유지하면서 현실의 시간 흐름을 인식하고,
사용자와 지속적인 관계를 형성하는 것처럼 느껴지게 만드는 것이다.

현재 단계에서는 production infrastructure보다
기능 검증, 안정성, 캐릭터 몰입감을 우선한다.


---

# 1. Source of Truth

같은 정보를 여러 파일에 중복 정의하지 않는다.

각 영역의 source of truth는 다음과 같다.

- 캐릭터 목록 / 성격 / 말투 / 이미지 / tagline / systemPrompt
  → `lib/characters.ts`

- 리마인더 요청 판별
  → `lib/reminderGuard.ts`

- 날짜 및 리마인더 시간 계산
  → `lib/time.ts`

- 캐릭터와 마지막 대화 이후 경과 시간 계산
  → `lib/interactionTime.ts`

- 메시지 / 리마인더 persistence
  → `lib/store.ts`

- proactive reminder 처리
  → `lib/scheduler.ts`

- 일반 채팅 및 reminder 생성 API 흐름
  → `app/api/chat/route.ts`

- Shared Memory 데이터 모델 / persistence / dedup / retrieval
  → `lib/memoryStore.ts`

- Shared Memory 추출(Chat/Story 각각의 별도 Claude 호출)
  → `lib/memoryClaude.ts`

- Shared Memory를 Claude prompt 문자열로 포맷팅
  → `lib/memoryPrompt.ts`

CLAUDE.md에는 위 파일들의 실제 데이터나 세부 캐릭터 설정을
불필요하게 복제하지 않는다.


---

# 2. Core Architecture Principle

## LLM과 deterministic logic을 분리한다.

Claude에게 시스템 상태나 정확한 계산을 맡기지 않는다.

Claude가 담당하는 것:

- 자연어 이해
- 캐릭터 답변 생성
- 캐릭터 personality 표현
- 리마인더 요청의 구조화된 정보 추출
- 서버가 제공한 시간 정보를 자연스럽게 표현

서버 코드가 담당하는 것:

- 현재 시각 확인
- 날짜 계산
- triggerAt 계산
- 경과 시간 계산
- 날짜 유효성 검사
- reminder 생성 여부 최종 판단
- duplicate 검사
- characterId 관리
- 상태 저장


예:

잘못된 방식:

Claude에게
"내일 오후 2시가 정확히 언제인지 계산해줘."

올바른 방식:

Claude:
relative_days = 1
hour = 14
minute = 0

서버:
실제 triggerAt 계산


이 원칙을 새로운 기능에서도 유지한다.


---

# 3. Character Architecture

모든 기능은 가능한 한 `characterId` 기반의 공통 시스템으로 구현한다.

새 캐릭터를 추가할 때 다음 기능을 복사하거나 캐릭터별로 따로 구현하지 않는다.

- reminder
- scheduler
- reminderGuard
- 날짜 계산
- Time Awareness
- store
- API route
- polling

캐릭터별 차이는 가능한 한 `lib/characters.ts`의 configuration과
systemPrompt를 통해 표현한다.

캐릭터 상세 성격, 말투, 시간 인식 스타일은
`lib/characters.ts`를 source of truth로 사용한다.

UI에서도 특정 캐릭터 ID를 하드코딩한 분기를 가능한 한 만들지 않는다.


---

# 4. Reminder System

리마인더는 이 프로젝트의 핵심 기능 중 하나다.

사용자는 미래 시점에 캐릭터가 특정 행동이나 발화를 하도록 요청할 수 있다.

예:

- "1분 뒤 알려줘"
- "10분 뒤 공부하라고 해줘"
- "1분 뒤 응원해줘"
- "1분 뒤 잔소리 좀 해줘"
- "내일 오후 2시에 알려줘"
- "모레 오전 9시에 말해줘"
- "3일 뒤 이 시간에 알려줘"
- "8월 20일 오후 3시에 알려줘"


현재 MVP에서 지원하지 않는 것:

- 반복 일정
- 매일 / 매주 / 매월 reminder
- 복잡한 캘린더 일정
- 다국가 timezone


현재 MVP의 시간 기준은 KST(Asia/Seoul)이다.


---

# 5. Reminder Safety Rules

Claude가 `schedule_reminder` tool을 호출했다고 해서
바로 Reminder를 생성해서는 안 된다.

Reminder 생성의 최종 권한은 서버에 있다.

현재 reminder 생성 파이프라인의 핵심 방어 구조를 유지한다.

개념적으로:

1. 현재 user message 확인
2. 미래 시간 표현 확인
3. 행동 / 발화 요청 여부 확인
4. `source_text`가 실제 current user message에서 나온 것인지 확인
5. extraction 검증
6. triggerAt 계산
7. 시간 유효성 검사
8. duplicate 검사
9. Reminder 생성


## 유령 리마인더 회귀 방지

과거에 다음 문제가 발생했다.

사용자:
"3분 뒤 알려줘"

→ 정상 reminder 등록
→ 정상 발화

이후 사용자:
"고마워"

그런데 Claude가 conversation history에 있던
과거 reminder 요청을 다시 읽고 새로운 Reminder를 등록했다.

이를 막기 위해 현재 다음 방어가 존재한다.

- `<current_user_message>` 구분
- reminder hard guard
- `source_text` 검증
- duplicate 검사

이 구조를 제거하거나 임의로 약화시키지 않는다.

특히 일반적인 후속 대화가 reminder를 생성하면 안 된다.

예:

- "고마워"
- "알려줘서 고마워"
- "됐어"
- "응"
- "이제 그만해"
- "다른 얘기하자"


Reminder 인식 범위를 넓힐 때도
false positive가 다시 증가하지 않는지 반드시 확인한다.


---

# 6. Reminder Natural Language Principle

Reminder를 단순히 "알려줘"라는 표현으로만 해석하지 않는다.

사용자가 명확한 미래 시점과 함께
그 시점에 캐릭터에게 행동이나 발화를 요청했다면
Reminder 요청으로 볼 수 있다.

예:

- "1분 뒤 응원해줘"
- "10분 뒤 잔소리 좀 해줘"
- "5분 뒤 힘내라고 말해줘"
- "내일 시험 잘 보라고 응원해줘"

하지만 시간이 없는 일반 요청은 Reminder로 만들지 않는다.

예:

- "응원해줘"
- "잔소리 좀 해줘"

이 경우 일반 대화로 처리한다.

Reminder guard를 수정할 때는
정상 요청을 더 많이 지원하면서도
유령 리마인더 방지 구조가 유지되는지 함께 검증한다.


---

# 7. Time Awareness

캐릭터는 사용자가 해당 캐릭터와 마지막으로 실제 대화한 이후
얼마나 현실 시간이 흘렀는지 인식할 수 있다.

시간 계산은 Claude가 하지 않는다.

서버가:

현재 시각
-
해당 characterId의 마지막 user message 시각

을 이용해 경과 시간을 계산한다.

Claude는 계산된 결과를 전달받아
캐릭터 personality에 맞게 표현한다.


예:

서버 계산:

days = 8
hours = 3
minutes = 40

Claude 표현:

캐릭터에 따라

"일주일 넘게 안 왔네."

또는

"8일하고 3시간 40분이나 지났네."

처럼 달라질 수 있다.


## Time Awareness threshold

현재 기준:

- 30분 미만
  → Time Awareness context 없음

- 30분 ~ 6시간
  → light

- 6시간 ~ 24시간
  → notable

- 1일 ~ 3일
  → several_days

- 3일 ~ 7일
  → long

- 7일 ~ 30일
  → very_long

- 30일 이상
  → extremely_long (very_long보다 반응 강도를 한 단계 더 높이되, 비난·협박·과도한 집착
    강요로 흐르지 않는다)

실제 기준값의 source of truth는 `lib/interactionTime.ts`이다.


## 반복 언급 방지

사용자가 오랜만에 돌아온 첫 메시지에서 시간 경과를 언급한 뒤,
이어지는 모든 답변에서 같은 시간을 반복해서 말하지 않도록 한다.

현재 구조에서는 새 user message가 저장되면
다음 요청부터 last interaction gap이 짧아지기 때문에
Time Awareness context가 자연스럽게 비활성화된다.

이 구조를 불필요하게 복잡하게 만들지 않는다.


---

# 8. Time Awareness Development Override

실제 `Message.createdAt`을 테스트 목적으로 수정하지 않는다.

Time Awareness 테스트는 development-only override를 사용한다.


---

# 9. Shared Memory

Chat과 Story(Guest Character로 초대된 경우만)가 "캐릭터가 사용자에 대해 기억하는 중요한
사실/사건"을 공유하는 별도 계층이다. Chat/Story 전체 대화를 서로 밀어넣지 않는다 —
중요하다고 판단된 기억만 `lib/memoryStore.ts`에 저장하고, 필요할 때 최대 5개만 골라
Claude 호출에 끼워 넣는다.

## 범위

- 이번 단계는 **Guest Character(= `lib/characters.ts`의 Chat Character)만** 대상이다.
  Story 원작 캐릭터(`Story.characters`)는 제외 — 세션 history 안에서만 기억한다.
- Memory는 반드시 `characterId`로 격리된다. 레이가 아는 것과 유이가 아는 것은 섞이지
  않는다.
- 카테고리 taxonomy는 두지 않는다. 모든 memory는 importance + recency로 균일하게
  처리된다.

## 추출 시점

- **Chat**: 해당 캐릭터의 user 메시지 개수가 4의 배수일 때, 기존 Reminder 방어
  파이프라인이 전부 끝나고 응답이 확정된 뒤에만 별도 Claude 호출로 추출한다
  (`app/api/chat/route.ts`).
- **Story**: Guest가 세션에 있는 동안 user 턴 8개마다 미처리 구간을 증분 추출하고
  (`app/api/story/turn/route.ts`), Guest가 제거될 때 남은 구간을 마지막으로 한 번 더
  추출한다(`guests/[characterId]/route.ts` DELETE). 추출 커서(`GuestCharacterSlot.
  lastMemoryExtractedAt`)는 "지금 시각"이 아니라 "실제로 처리된 마지막 메시지의
  createdAt"으로 전진시킨다 — memory가 0개 추출돼도 호출 자체가 성공했다면 커서는
  전진한다(같은 구간이 매 턴 반복 재추출되지 않도록).

두 추출 모두 `schedule_reminder`의 호출·응답 루프와 물리적으로 완전히 분리된 별도
Claude 호출이다(`lib/memoryClaude.ts`). 이 분리를 약화시키지 않는다.

## dedup

`findSimilarMemory`는 Jaccard 유사도 0.8 이상인 근접-중복만 병합 대상으로 삼는다(짧은
문장의 단어 하나 차이나 의미 충돌은 병합하지 않고 별도 행으로 공존시킨다 — 오탐 병합보다
중복 허용을 우선한다). recency는 `createdAt`이 아니라 `updatedAt` 기준이다.

## prompt 주입

Memory는 캐릭터에게 "확정된 사실"이 아니라 "어렴풋한 기억"으로 제시한다. Chat은
`chatWithCharacter`의 `system` 끝에 `<shared_memory>` 블록으로(user 턴이 아님 —
`<current_user_message>`/`source_text` 판정 경계와 분리하기 위함), Story는
`buildGuestCharacterBrief` 안에 게스트별 "기억:" 줄로 덧붙인다. memory가 없으면 두 경로
모두 이 기능 도입 전과 완전히 동일한 출력을 낸다.

# 10. Story Mode Architecture

Story Mode는 Chat Mode와 별개의 독립 시스템이다.

사용자는 미리 정의된 Story 세계관 안에서 자유롭게 행동하거나 대화할 수 있으며,
Claude는 사용자의 입력과 현재까지의 Story history를 바탕으로 인터랙티브 소설 형태로
이야기를 이어간다.

현재 Story 데이터의 source of truth는 다음과 같다.

* Story 목록 / 세계관 / 장르 / 기본 등장인물 / 시작 장면 / 진행 규칙
  → `lib/stories.ts`

* Story system prompt 조립
  → `lib/storyPrompt.ts`

* Story Claude 호출
  → `lib/storyClaude.ts`

* Story session / message / guest character persistence
  → `lib/storyStore.ts`

* Story 진행 API
  → `app/api/story/turn/route.ts`

* Story session 생성 / 조회
  → `app/api/story/sessions/`

* Guest Character 초대 / 제거
  → `app/api/story/sessions/[sessionId]/guests/`

* Story 진행 UI
  → `components/story/StoryScreen.tsx`

Story 데이터를 다른 파일에 중복 정의하지 않는다.

특히 Story의 worldview, rules, characters, openingScene을
완성된 system prompt 형태로 별도 저장하지 않는다.

`buildStorySystemPrompt()`가 요청 시점마다 source of truth에서 조립한다.

---

# 11. Chat Mode와 Story Mode 분리 원칙

Chat Mode와 Story Mode는 의도적으로 분리되어 있다.

다음 기능은 Chat Mode 전용이다.

* Reminder
* Scheduler
* Time Awareness
* Cross Character Awareness의 Chat 동작
* Chat Message Store
* Chat Claude tool 호출

Story Mode에서는 위 기능을 직접 사용하지 않는다.

Story Mode는 다음 파일을 불필요하게 import하거나 재사용하지 않는다.

* `lib/store.ts`
* `lib/scheduler.ts`
* `lib/reminderGuard.ts`
* `lib/time.ts`
* `lib/interactionTime.ts`
* Chat Mode의 reminder tool pipeline

Story Mode의 Claude 호출은 반드시 `lib/storyClaude.ts`를 통해 처리한다.

Chat Mode의 `chatWithCharacter()`를 Story에서 재사용하지 않는다.

이 분리는 기능 중복이 아니라,
두 모드의 목적과 prompt 성격이 다르기 때문에 의도적으로 유지하는 구조다.

---

# 12. Story Session

같은 Story를 여러 번 플레이할 수 있다.

따라서 다음 개념을 구분한다.

* `storyId`
  → 어떤 Story인지 나타냄

* `sessionId`
  → 해당 Story의 특정 플레이 기록

하나의 Story에 여러 Session이 존재할 수 있다.

예:

눈보라 속 산장

* Session A
* Session B
* Session C

각 Session은 서로 다른 다음 상태를 가진다.

* conversation history
* createdAt
* updatedAt
* Guest Character
* Story 진행 내용

Story 화면을 단순 조회하는 것만으로 새로운 Session을 생성하지 않는다.

새 Session 생성은 사용자의 명시적인 "새로 시작" 행동에서만 발생해야 한다.

GET 계열 조회 로직에서 `createStorySession()`을 호출하지 않는다.

---

# 13. Guest Character

사용자는 Chat Mode에서 대화하던 Character를 Story에 Guest Character로 초대할 수 있다.

Guest Character는 `lib/characters.ts`의 Character를 참조한다.

Story 원작 등장인물과 Guest Character는 다른 개념이다.

## Story Character

`lib/stories.ts`

예:

* 서윤
* 하준

해당 Story 세계관에 원래 존재하는 인물이다.

## Guest Character

`lib/characters.ts`

예:

* 레이
* 유이
* 미나
* 루나
* 세라
* 아린

사용자가 Story Session에 초대한 Chat Character다.

두 캐릭터 시스템을 합치거나 하나의 데이터 모델로 강제 통합하지 않는다.

---

# 14. Guest Character Prompt Rules

Guest Character를 Story에 초대할 때
Chat Character의 전체 `systemPrompt`를 Story system prompt에 넣지 않는다.

Chat Character의 systemPrompt에는 다음과 같은 Chat 전용 기능이 포함되어 있기 때문이다.

* 짧은 메신저 답변 형식
* Reminder
* schedule_reminder tool
* Time Awareness
* Chat 전용 반응 규칙

Story에서는 Guest Character의 순수한 캐릭터성만 가져온다.

현재 사용하는 정보:

* `personalitySummary`
* `speechStyle`

Guest Character는 Story 안에서도 자신의 성격과 말투를 유지하지만,
Story 세계관과 진행 규칙을 항상 우선한다.

Prompt 우선순위는 다음 원칙을 유지한다.

Story 세계관
→ Story 진행 규칙
→ Story 원작 등장인물
→ Guest Character
→ Story 공통 규칙

Guest Character가 Story 전체를 지배하거나
원작 등장인물을 밀어내도록 만들지 않는다.

Guest Character는 모든 응답에 반드시 등장할 필요가 없다.

---

# 15. Guest Character 최초 등장

Guest Character가 Session에 초대된 뒤 아직 Story 응답에 등장한 적이 없다면,
다음 Claude 응답에서 자연스럽게 Story 안에 등장시킨다.

예:

* 문이 열리며 들어온다.
* 근처에 있었다는 사실을 발견한다.
* 기존 사건과 관련된 자연스러운 계기로 합류한다.

Guest Character를 설명 없이 갑자기 장면 안에 존재하는 것으로 처리하지 않는다.

최초 등장 강제 지시는 한 번만 적용한다.

이후에는 이미 Story에 합류한 Character로 간주하고 자연스럽게 진행한다.

---

# 16. Guest Character Capacity

현재 MVP에서는 하나의 Story Session에 Guest Character를 최대 1명만 초대할 수 있다.

실제 제한의 source of truth:

`lib/storyStore.ts`

`MAX_GUEST_CHARACTERS_PER_SESSION`

Guest Character 데이터 구조 자체는 배열을 사용한다.

따라서 향후 여러 Guest를 지원할 때
기존 스키마를 불필요하게 다시 설계하지 않는다.

가능하면 기존 배열 구조를 유지하고 capacity만 확장한다.

---

# 17. Story Shared Memory

Shared Memory는 Chat Mode와 Story Mode를 연결하는 유일한 주요 공통 계층이다.

단, 전체 대화 history를 공유하지 않는다.

Character가 사용자에 대해 기억할 가치가 있는 중요한 사실이나 사건만
Memory로 추출하여 공유한다.

예:

Chat:

사용자:
"다음 주에 SQLD 시험이 있어."

Memory:

"사용자는 다음 주 SQLD 시험을 준비하고 있다."

이후 해당 Character가 Story에 Guest로 참여하면
이 Memory를 Story에서도 사용할 수 있다.

Guest Character가 Story에서 경험한 중요한 사건도 다시 Memory로 저장되어
향후 Chat에서 참고될 수 있다.

---

# 18. Memory Isolation

Memory는 반드시 `characterId` 기준으로 분리한다.

예:

레이가 아는 정보
≠
유이가 아는 정보

한 Character의 Memory를 다른 Character에게 전달하지 않는다.

Story 원작 Character에는 현재 Shared Memory를 적용하지 않는다.

Shared Memory 대상은 `lib/characters.ts`의 Chat Character가
Guest Character로 Story에 참여하는 경우로 제한한다.

---

# 19. Story Memory Extraction

Story 진행 중 매 턴마다 Memory extraction Claude 호출을 하지 않는다.

현재 기준:

Guest Character가 Session에 존재하는 동안
user turn이 일정 횟수 누적되면 미처리 구간을 대상으로 Memory를 추출한다.

실제 interval의 source of truth는:

`lib/memoryClaude.ts`

Guest가 Story에서 제거될 때는
아직 처리하지 않은 마지막 구간이 있다면 최종 Memory extraction을 수행한다.

Memory extraction은 Story 응답 생성과 별도의 Claude 호출이다.

Story 답변 생성 실패와 Memory 추출 실패를 서로 결합하지 않는다.

Memory extraction이 실패해도 이미 생성된 Story 응답은 정상 유지되어야 한다.

---

# 20. Memory Extraction Cursor

Story Guest Memory extraction은
각 Guest의 `lastMemoryExtractedAt`을 cursor로 사용한다.

Cursor는 현재 시각으로 갱신하지 않는다.

실제로 Memory extraction에 사용된 마지막 StoryMessage의 `createdAt`으로 갱신한다.

Memory가 0개 추출되더라도
Claude extraction 호출 자체가 정상적으로 성공했다면 cursor는 전진시킨다.

그렇지 않으면 같은 대화 구간이 매 턴 반복해서 extraction되는 문제가 발생할 수 있다.

반대로 Claude 호출 자체가 실패한 경우에는 cursor를 전진시키지 않는다.

다음 턴에서 동일 구간을 다시 처리할 수 있어야 한다.

---

# 21. Story Progress Principle

현재 Story Mode는 고정된 선택지 게임이 아니다.

사용자는 자유롭게 다음과 같은 입력을 할 수 있다.

* 대화
* 행동
* 질문
* 탐색
* 상황에 대한 반응

Claude는 사용자의 입력을 바탕으로 Story를 이어간다.

사용자가 하지 않은 행동, 감정, 대사를
사용자 Character의 것으로 임의로 확정하지 않는다.

잘못된 예:

사용자:
"문을 바라본다."

AI:
"당신은 겁에 질려 문을 열고 밖으로 뛰쳐나갔다."

올바른 방향:

사용자가 명시한 행동까지만 확정하고
그에 대한 환경과 NPC의 반응을 생성한다.

---

# 22. Story Consistency

Story 응답 생성 시 다음 우선순위를 유지한다.

1. 현재 Story 세계관
2. Story rules
3. 지금까지의 Session history
4. Story 원작 Character의 성격
5. Guest Character의 성격과 기억
6. 현재 사용자의 입력

Claude가 즉흥적으로 재미있는 전개를 만드는 것보다
기존 Story의 일관성을 유지하는 것이 더 중요하다.

사용자가 명시적으로 요청하지 않는 이상:

* 갑작스러운 시간 점프
* 설정 변경
* 이미 발생한 사건의 무효화
* Character 성격 급변
* 근거 없는 새로운 핵심 설정 추가

를 피한다.

---

# 23. Story UI State

Story UI에서 서버가 source of truth인 상태를
클라이언트에 별도 영구 source of truth로 중복 저장하지 않는다.

예:

* Session
* Story Message
* Guest Character

위 상태는 서버의 Story Store가 기준이다.

React state는 현재 UI 표현과 즉시 반응을 위한 상태로만 사용한다.

Story 화면 재접속 시
서버에 저장된 Session 상태를 기준으로 복원한다.

---

# 24. Current MVP Scope

현재 Story Mode의 목표는 production 규모의 완성된 게임 엔진이 아니다.

현재 우선순위:

1. 자유로운 AI Story 진행
2. Story 세계관 일관성
3. Guest Character 자연스러운 합류
4. Chat Character personality 유지
5. Shared Memory를 통한 Character 관계 지속성
6. Session 저장 및 이어하기

현재 MVP 범위를 벗어나는 기능은
기존 구조를 불필요하게 복잡하게 만들면서 먼저 구현하지 않는다.

예:

* 대규모 branching graph
* 복잡한 quest engine
* Story Character 전용 장기 Memory
* 다수 Guest Character 동시 상호작용 최적화
* production database
* multiplayer Story

---

# 25. Future Development Principle

새 기능을 개발할 때 먼저 다음을 확인한다.

1. 이 기능은 Chat Mode인가 Story Mode인가 Shared Layer인가?
2. 기존 source of truth가 있는가?
3. 동일한 데이터를 다른 파일에 중복 정의하게 되지 않는가?
4. deterministic logic을 Claude에게 맡기고 있지는 않은가?
5. Chat 전용 기능이 Story Mode로 의도치 않게 유입되지는 않는가?
6. Character별 하드코딩 대신 `characterId` 기반 공통 구조로 만들 수 있는가?
7. 기존 Session / Memory 데이터를 깨뜨리지 않는가?

기능을 추가하기 전에 기존 구조를 최대한 재사용하되,
Chat과 Story의 의도적인 경계를 억지로 통합하지 않는다.

이 프로젝트에서 중요한 것은 코드 수를 줄이는 것 자체가 아니라

**Character의 일관성, Story의 일관성, 상태의 정확성, 기능 간 경계의 명확성**

을 유지하는 것이다.

---

# 26. UI / Design System Principle

이 프로젝트는 단순한 AI chatbot UI가 아니라
캐릭터와 관계를 형성하고 Story 경험으로 확장되는
"Modern Character Entertainment App"을 지향한다.

UI를 수정할 때 generic AI SaaS / dashboard / messenger clone처럼
보이지 않도록 한다.

현재 디자인의 핵심 원칙:

- Character illustration이 UI box보다 우선한다.
- 모든 콘텐츠를 동일한 rounded card 안에 넣지 않는다.
- border / shadow / gradient를 장식 목적으로 남발하지 않는다.
- layout hierarchy는 box보다 typography / spacing / illustration으로 만든다.
- 캐릭터별 개성은 전체 UI 색을 바꾸는 방식이 아니라
  제한된 accent와 illustration을 통해 표현한다.
- Chat Mode와 Story Mode는 같은 서비스의 visual identity를 공유하지만
  서로 다른 경험으로 명확하게 느껴져야 한다.

디자인 관련 변경에서는 기능/API/store 구조를 이유 없이 함께 수정하지 않는다.

---

# 27. Design Token Source of Truth

현재 공통 visual token의 source of truth는:

`app/globals.css`

이다.

주요 토큰:

- `paper`
  → Home / Chat 기본 배경

- `paper-sunken`
  → 한 단계 낮은 surface / section 구분

- `ink`
  → 기본 본문 텍스트

- `ink-soft`
  → 보조 텍스트 / timestamp / tagline

- `seal`
  → 브랜드 action / reminder / 중요한 상태 강조

- `seal-soft`
  → seal의 옅은 background tint

- `memory`
  → Shared Memory 전용 visual accent

- `story-bg`
  → Story Mode의 dark cinematic base

- `story-ink`
  → Story Mode의 기본 밝은 텍스트

기존 token으로 표현 가능한 색을 Tailwind 기본 hue로 새로 만들지 않는다.

예:

피해야 할 방식:

- `text-red-500`
- `bg-purple-500`
- `border-amber-300`

이미 의미가 존재하는 경우:

- `text-seal`
- `bg-seal-soft`
- `text-memory`
- `bg-story-bg`

를 우선 사용한다.

단, error / destructive state처럼 의미가 명확히 다른 경우에는
semantic red 계열 사용을 허용한다.

---

# 28. Typography

현재 font source of truth는 `app/layout.tsx`와 `app/globals.css`이다.

기본 UI / 본문:

- Pretendard
- `font-sans`

Display:

- Gowun Batang
- `font-display`

Utility:

- Geist Mono
- `font-mono`

원칙:

- Chat message 본문에는 display serif를 사용하지 않는다.
- 긴 본문에는 Pretendard를 우선한다.
- `font-display`는 Character name, Story title 등
  제한된 emotional hierarchy 용도로만 사용한다.
- 새로운 컴포넌트에서 Arial / Helvetica 등의 font-family를
  직접 하드코딩하지 않는다.

---

# 29. Character Illustration Principle

Character image의 source of truth는 `lib/characters.ts`이다.

현재 Character asset은 배경 없는 PNG cutout / sticker 형태를 기준으로 한다.

따라서:

- Character image를 정사각 `object-cover`로 강제 crop하지 않는다.
- 가능하면 원본 aspect ratio를 유지한다.
- 원형 avatar가 필요한 기능적 이유가 없는 곳에서는
  illustration을 box 안에 가두지 않는다.
- Home / Chat에서 같은 Character가 서로 다른 사람처럼 보이지 않도록
  동일 image source를 사용한다.
- 새로운 캐릭터 UI를 만들 때 캐릭터별 하드코딩 이미지 경로를 만들지 않는다.

Character illustration은 decoration이 아니라
이 앱의 primary visual identity다.

---

# 30. Home UI Principle

Home은 AI 기능 목록이나 dashboard가 아니다.

사용자가 현재 관계를 이어가고 있는 Character를
가장 먼저 인식할 수 있는 공간이어야 한다.

현재 방향:

1. 최근 대화 Character를 Hero로 보여준다.
2. Character illustration을 UI보다 크게 보여준다.
3. Character 목록은 boxed 2-column grid보다
   horizontal character rail을 사용한다.
4. Story Mode는 Character 영역 아래에서
   cinematic teaser로 보여준다.

피해야 할 것:

- 동일한 크기의 card 반복
- dashboard-style widget grid
- Character마다 배경 box를 강제하는 구조
- Story Mode가 Home의 Character 영역보다 과도하게 커지는 것

Story teaser는 Home의 secondary destination이다.

남는 layout 공간을 채우기 위해
Story teaser를 `flex-grow`시켜 과도하게 확대하지 않는다.

---

# 31. Chat UI Principle

Chat Mode는 일반적인 chatbot이나 messenger clone처럼 보이지 않아야 한다.

목표는:

"AI와 채팅한다"

보다

"이 Character와 1:1로 대화한다"

는 느낌이다.

현재 Chat UI의 핵심 구성:

- `components/ChatWindow.tsx`
- `components/ChatHeader.tsx`
- `components/MessageBubble.tsx`
- `components/ReminderSystemCard.tsx`
- `components/ProcessingIndicator.tsx`

Chat UI를 수정할 때 위 파일의 책임을 유지한다.

---

# 32. Chat Header

Chat Header는 Home에서 본 Character가
자연스럽게 대화 화면까지 이어진다는 느낌을 준다.

현재 원칙:

- Character image를 원형 avatar로 강제 crop하지 않는다.
- 원본 PNG illustration 비율을 유지한다.
- Character name은 주요 hierarchy다.
- Character tagline은 secondary information이다.
- Memory와 Reminder는 별도의 action이다.

Memory:

`memory` visual token

Reminder:

`seal` visual token

을 사용한다.

캐릭터별로 Header 전체 색상을 하드코딩하지 않는다.

캐릭터별 차이는 기존 accent configuration을 통해 표현한다.

---

# 33. Chat Message Language

현재 Chat Message의 visual hierarchy는 의도적이다.

## User Message

사용자가 보낸 메시지는:

- 오른쪽 정렬
- `seal-soft` background
- rounded message shape

를 사용한다.

User message를 강한 `seal` solid background로 바꾸지 않는다.
대화가 쌓였을 때 브랜드 색이 화면 전체를 지배하지 않게 하기 위함이다.

## Character Message

Character message는 일반적인 filled bubble을 사용하지 않는다.

현재:

- paper background 위 text
- Character accent의 얇은 left rule

을 이용해 Character의 말을 표현한다.

이 구조는 의도적으로
"AI chatbot bubble" 느낌을 줄이기 위한 것이다.

모든 Character message를 white rounded card로 감싸지 않는다.

---

# 34. Reminder Message Visual Rule

Reminder / proactive message는
일반 Chat response와 의미가 다르다.

사용자가 지금 질문해서 받은 응답이 아니라
Character가 먼저 말을 건 event이기 때문이다.

따라서 다음 차이를 유지한다.

- `"먼저 말을 걸었어요"` 등의 indicator
- `seal` 의미색
- 일반 message보다 조금 강한 entrance animation

하지만:

- 지나치게 큰 system card
- modal 수준의 interruption
- 과도한 flashing animation

은 사용하지 않는다.

Reminder가 특별하다는 것은 보여주되
대화 흐름 자체를 깨지 않는다.

---

# 35. Chat Input Principle

Chat input은 일반적인 AI prompt box처럼 보이지 않도록 한다.

현재 방향:

- 과도하게 큰 rounded textarea를 사용하지 않는다.
- 입력창 background를 별도 card처럼 띄우지 않는다.
- underline / minimal surface 방식 유지
- Send action만 작은 visual emphasis를 준다.

Character Chat은 command interface가 아니라 conversation interface다.

따라서:

- magic wand
- AI sparkle
- model selector
- prompt icon

같은 generic AI UI 요소를 불필요하게 추가하지 않는다.

---

# 36. Scroll UI

phone frame 내부의 scroll container에서는
브라우저 scrollbar UI를 노출하지 않는다.

공통 source:

`app/globals.css`

`.no-scrollbar`

를 사용한다.

중요:

scrollbar를 숨기는 것은
scroll 기능을 제거하는 것이 아니다.

다음은 유지해야 한다.

- `overflow-y-auto`
- `overflow-x-auto`
- mouse wheel
- trackpad
- touch scroll
- scroll ref
- auto scroll behavior

scrollbar를 숨기기 위해 `overflow-hidden`으로 바꾸지 않는다.

---

# 37. Animation Principle

Animation은 상태 변화의 의미를 전달할 때만 사용한다.

현재 주요 animation:

- message entrance
- proactive reminder message 강조
- bell ring
- phone shake
- sheet up

source of truth:

`app/globals.css`

새 animation을 만들기 전에 기존 animation을 재사용할 수 있는지 확인한다.

피해야 할 것:

- 모든 hover에 scale
- 모든 card에 floating animation
- 장식 목적의 무한 animation
- excessive bounce
- 지나친 glass / blur animation

`prefers-reduced-motion` 대응을 유지한다.

---

# 38. UI Refactoring Safety

UI 리디자인은 기존 기능 변경과 분리한다.

디자인 작업 시 특별한 이유가 없다면 다음 파일을 수정하지 않는다.

- API route
- store
- scheduler
- reminder guard
- time calculation
- memory extraction
- Story prompt
- Character prompt

UI 변경 과정에서 기존 handler / props / ref를
단순히 디자인상 필요 없어 보인다는 이유로 제거하지 않는다.

특히 다음 기능 연결을 보존한다.

- Home → Chat navigation
- Chat message auto-scroll
- Reminder polling
- Reminder panel
- Memory panel
- Story session
- Guest invitation
- Story scroll tracking

UI 작업 후에는 visual 확인뿐 아니라
기존 interaction이 유지되는지 확인한다.

---

# 39. Incremental Design Development

전체 UI를 한 번에 리디자인하지 않는다.

현재 권장 순서:

Home
→ Chat
→ Memory / Reminder Panels
→ Story
→ Guest Invite
→ 전체 visual consistency review

각 단계에서:

1. 기존 화면 분석
2. 수정 범위 결정
3. UI만 구현
4. 브라우저에서 직접 확인
5. 문제 수정
6. 다음 화면으로 이동

을 따른다.

이미 완료된 Home / Chat의 visual language를
다음 화면에서 임의로 새로 정의하지 않는다.

기존 Design Token과 Character Illustration language를
우선 재사용한다.

---

# 40. Design Review Checklist

UI 변경 후 최소한 다음을 확인한다.

- Character illustration이 잘리지 않는가?
- Character asset의 aspect ratio가 유지되는가?
- 동일한 rounded card가 반복되고 있지 않은가?
- border / shadow가 과도하지 않은가?
- Tailwind 기본 accent color를 의미 없이 추가하지 않았는가?
- typography hierarchy가 명확한가?
- Chat과 Story가 같은 앱처럼 보이면서도 다른 경험인가?
- scrollbar UI가 phone frame 안에 노출되지 않는가?
- 좁은 mobile width에서 text가 잘리지 않는가?
- Character rail의 이름 / 상태가 보이는가?
- Story teaser가 Home의 핵심 Character UI를 침범하지 않는가?
- reminder / memory action이 기존대로 동작하는가?
- API / store / state logic에 불필요한 변경이 없는가?

---

# 41. Memory UI Final Principle

Memory UI는 단순한 CRUD 목록이 아니라
"Character가 사용자에 대해 기억하고 있는 것"처럼 느껴져야 한다.

현재 방향:

- visual accent는 `memory` token을 사용한다.
- 기본 아이콘은 `MemoryMark`를 사용한다.
- `🧠` emoji를 기본 Memory 아이콘으로 되돌리지 않는다.
- Memory item은 rounded card 반복보다 flowing list + divider를 사용한다.
- importance는 별점이 아니라 vividness dot 방식으로 표현한다.
- Character illustration + 이름으로 "누구의 기억인지" 보여준다.
- delete action은 평소 low emphasis로 두고, destructive 순간에만 red를 사용한다.
- Memory header는 과한 보라색 surface보다 subtle tint / watermark / glow 정도만 사용한다.

MemoryMark는 "기억의 흔적 / 울림"을 표현하는 공통 visual glyph다.

---

# 42. Reminder UI Final Principle

Reminder UI는 일반 alarm / task manager가 아니라
"Character와 한 약속" 또는
"앞으로 Character가 먼저 건넬 말"처럼 느껴져야 한다.

현재 방향:

- visual accent는 `seal` token을 사용한다.
- 기본 아이콘은 `ReminderMark`를 사용한다.
- `🔔` emoji를 기본 Reminder 아이콘으로 남발하지 않는다.
- ReminderPanel은 시간 중심의 agenda layout을 사용한다.
- 시간 정보가 content보다 먼저 인식될 수 있도록 hierarchy를 유지한다.
- pending / fired / failed 상태는 과도한 badge보다
  typography / opacity / subtle state 표현으로 구분한다.
- proactive reminder message는 일반 Chat response보다 조금 더 특별하게 보이되
  대화 흐름을 깨지 않는다.

ReminderMark는 "정해진 미래의 한 순간 / 약속"을 표현하는 공통 visual glyph다.

---

# 43. Story Lobby Visual Principle

Story Lobby는 일반 콘텐츠 목록이 아니라
"다른 세계로 들어가기 전의 cinematic library"처럼 보여야 한다.

현재 Story Lobby의 visual direction:

- 전체 배경은 warm beige / brown이 아니라
  cool charcoal / subtle blue-gray 계열을 사용한다.
- 관련 token은 `story-lobby-bg`, `story-lobby-sunken`이다.
- Continue Session은 일반 card가 아니라 cinematic Hero로 표현한다.
- 새로운 Story는 poster-style cover 중심으로 보여준다.
- Story History는 compact flowing list + divider를 사용한다.
- Story cover image 위에 과도한 white overlay를 씌우지 않는다.
- neon / game launcher HUD / glassmorphism 남발을 피한다.

Story Lobby는 다음 transition의 중간 단계다.

Home / Chat
→ 밝은 paper surface

Story Lobby
→ cool dark cinematic lobby

Story 진행 화면
→ deeper dark cinematic world

---

# 44. Story Screen Visual Principle

Story 진행 화면은 Chat 화면과 명확히 다른
interactive fiction / visual novel experience를 지향한다.

현재 방향:

- cover image를 atmospheric background로 적극 활용한다.
- white wash 대신 dark scrim으로 가독성을 확보한다.
- narrator / assistant content는 일반 Chat bubble보다 prose처럼 읽히게 한다.
- user turn은 "사용자가 선택한 행동/대사"처럼
  italic + left rule 구조를 유지한다.
- Story input은 generic Chat input처럼 보이지 않게 한다.
- Guest Character는 header 또는 scene context에서 최소한으로 표시한다.
- Guest가 있다고 해서 모든 응답에서 Guest를 UI적으로 과도하게 강조하지 않는다.

Story에 실제 speaker metadata가 없는 경우
UI에서 임의로 화자를 추측하지 않는다.

---

# 45. Story Scroll Policy

Story는 Chat처럼 새 메시지가 생길 때마다
무조건 bottom으로 이동시키지 않는다.

원칙:

- 사용자가 bottom 근처에 있으면 새 user / assistant message를 자연스럽게 따라간다.
- 사용자가 위쪽 내용을 읽고 있으면 강제로 아래로 끌고 가지 않는다.
- near-bottom 판단이 필요할 때 실제 scroll container의 DOM 위치를 직접 확인한다.
- scroll event로 갱신되는 stale ref만 믿지 않는다.
- scroll 문제를 `overflow-hidden`, fixed height 등의 꼼수로 숨기지 않는다.
- `scrollIntoView()` 사용 시 대상과 block 위치를 명확히 한다.

현재 Story scroll 정책은 의도된 UX이므로
Chat auto-scroll 정책과 억지로 통합하지 않는다.

---

# 46. Guest Invite Panel Visual Principle

GuestInvitePanel은 Story 본체와 분리된 설정 layer이지만,
색감이 Story와 완전히 끊겨 보이지 않도록 한다.

현재 방향:

- 기본은 밝은 paper utility sheet를 유지한다.
- Story tone은 아주 옅은 wash / divider / hover tint에만 반영한다.
- 완전한 dark modal로 만들지 않는다.
- flowing list 구조를 유지한다.
- Character 선택 목록에서는 기능적 이유로 Avatar crop을 허용한다.
- remove action은 평소 low emphasis로 두고 destructive 순간만 red를 사용한다.

---

# 47. Error / Loading / Empty State

현재 error 표현은 두 계열로 단순화한다.

Light surface:
- `text-red-500`

Dark Story surface:
- `text-red-400`

같은 종류의 error를 화면마다 임의의 rose / amber / red 계열로 만들지 않는다.

Loading state:

- 불필요하게 큰 loader component를 만들지 않는다.
- 기존 state를 이용한 조용한 text feedback을 우선한다.
- Story 최초 로딩 시 완전한 빈 화면으로 두지 않는다.

Empty state:

- 단순히 "데이터 없음"이라고 표현하기보다
  Character / Reminder / Story context를 유지한다.

---

# 48. Phone Frame Principle

데스크톱에서는 앱이 중앙의 phone frame 안에 표시되고,
모바일에서는 실제 앱처럼 viewport를 사용한다.

현재 phone frame shell은 의도된 presentation layer다.

따라서:

- 단순히 legacy neutral class가 남아 있다는 이유로 제거하지 않는다.
- phone frame을 제거해 데스크톱의 중앙 휴대폰 데모 형태를 깨뜨리지 않는다.
- Chat과 Story의 frame 구조를 함께 고려한다.
- frame 수정이 필요하다면 layout 구조는 유지하고 최소한의 style diff만 적용한다.

---

# 49. Responsive / Overflow Principle

모바일 환경에서 horizontal overflow가 발생하지 않도록 한다.

특히 다음을 확인한다.

- 긴 Character name
- 긴 tagline
- 긴 Chat message
- 공백 없는 긴 문자열
- 긴 Story title
- 긴 Story response
- 많은 Memory / Reminder
- Guest UI

Story background처럼 의도적으로 scale된 요소는
부모 안에서 안전하게 clip되어야 하며
문서 전체의 horizontal scroll을 만들면 안 된다.

phone frame 내부 scroll container는 `.no-scrollbar`를 사용하되
실제 scrolling 기능은 유지한다.

---

# 50. UI Regression Validation

중요한 UI 변경 후 최소한 다음을 확인한다.

Static check:

- `npx tsc --noEmit`
- `npx eslint .`

주요 사용자 흐름:

1. Home → Character Chat
2. Chat message 송수신
3. Reminder 생성
4. Reminder proactive 발화
5. ReminderPanel 조회 / 삭제
6. MemoryPanel 조회 / importance 변경 / 추가 / 삭제
7. Story Lobby → 새 Story 시작
8. Story 이어하기
9. Story message 진행
10. Guest Character 초대 / 제거
11. Guest Shared Memory
12. Story History
13. StorySessionMissing
14. loading / error / empty state
15. mobile overflow / scroll / long text

UI 작업은 visual 확인만으로 끝내지 않고
기존 interaction과 주요 흐름이 유지되는지도 확인한다.

---

# 51. Final Product Experience

이 프로젝트의 핵심 경험은 기능이 각각 따로 존재하는 것이 아니라
Character와 사용자의 관계가 여러 모드를 통해 이어지는 것이다.

핵심 연결:

Chat
→ Time Awareness
→ Reminder
→ Shared Memory
→ Story
→ Guest Character
→ Shared Memory
→ 다시 Chat

새 기능이나 디자인을 추가할 때
독립적인 gimmick을 하나 더 만드는 것보다
이 관계의 연속성을 강화하는지를 먼저 판단한다.