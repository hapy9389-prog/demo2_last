import { Story } from "@/types/story";

// Story Mode 데이터의 source of truth. lib/characters.ts와 동일한 패턴
// (정적 배열 + getXById() 헬퍼)이지만, Story Character는 Chat Character와 완전히
// 별개다 — Story 안에 등장하는 인물은 lib/characters.ts를 참조하지 않는다.
//
// worldview/rules/characters/openingScene만 구조화 데이터로 저장하고, Claude system
// prompt 완성본은 저장하지 않는다 — lib/storyPrompt.ts의 buildStorySystemPrompt()가
// 요청 시점마다 조립한다.

export const STORIES: Story[] = [
  {
    id: "snowstorm-lodge",
    title: "눈보라 속 산장",
    description: "폭설에 고립된 산장, 낯선 사람들과 함께 밤을 보내야 한다.",
    // public/stories/snowstorm-lodge.png를 넣어두면 자동으로 이 이미지가 우선 표시된다(없으면 emoji 폴백).
    coverImage: "/stories/snowstorm-lodge.png",
    genre: "미스터리 · 드라마",
    worldview: `
겨울 산속의 작은 산장. 예정에 없던 폭설로 하산로가 전부 막혔고, 전화도 잘 터지지 않는다.
산장에는 관리인 없이 먼저 도착한 손님 몇 명만 머물고 있다. 벽난로 하나로 겨우 온기를
유지하고 있으며, 창밖은 한 치 앞도 보이지 않는 눈보라뿐이다. 다음날 아침까지는 아무도
산을 내려갈 수 없다는 사실을 다들 알고 있다.
`.trim(),
    openingScene: `
밖의 거센 눈보라가 문틈 사이로 밀려들었다.

당신은 몸을 잔뜩 웅크린 채 산장 문을 밀고 들어선다. 젖은 외투에서 눈이 뚝뚝 떨어지고,
손끝은 이미 감각이 없다.

산장 안에 있던 사람들이 일제히 당신을 바라봤다. 벽난로 옆에 앉아 있던 서윤이 천천히
자리에서 일어났다.

"이 날씨에 밖에 있었다고요?"

그녀는 놀란 얼굴로 당신의 젖은 외투를 바라보다가, 곧 수건 하나를 건넨다.

"일단 들어와요. 밖에 더 있으면 위험해요."
`.trim(),
    characters: [
      {
        id: "seoyun",
        name: "서윤",
        role: "산장에 먼저 도착해 있던 손님",
        personality:
          "차분하고 다정하지만 낯선 사람에게는 조심스럽다. 위기 상황에서는 침착하게 주변 사람을 먼저 챙기는 성격이며, 필요 이상으로 자기 사정을 먼저 꺼내놓지 않는다.",
      },
    ],
    rules: `
- 시간은 현재 장면(밤~다음날 아침 사이) 안에서만 자연스럽게 흐른다. 사용자가 명시적으로
  큰 시간 도약을 요청하지 않는 한 갑자기 며칠을 건너뛰지 않는다.
- 등장인물의 성격과 지금까지의 대화 맥락을 일관되게 유지한다.
- 사용자가 입력하지 않은 행동이나 대사를 사용자 캐릭터의 것으로 임의로 만들어내지 않는다.
- 필요 이상으로 폭력적이거나 자극적인 전개로 몰아가지 않는다 — 미스터리/드라마 톤을 유지한다.
`.trim(),
  },
  {
    id: "school-mystery",
    title: "학교 미스터리",
    description: "방과 후 텅 빈 학교, 이상한 소문의 진실을 쫓는다.",
    // public/stories/school-mystery.png를 넣어두면 자동으로 이 이미지가 우선 표시된다(없으면 emoji 폴백).
    coverImage: "/stories/school-mystery.png",
    genre: "미스터리 · 청춘",
    worldview: `
평범한 고등학교. 몇 주 전부터 "밤 10시가 넘으면 3층 음악실에서 피아노 소리가 들린다"는
소문이 돌고 있다. 오늘은 방과 후 늦게까지 학교에 남게 된 날이고, 복도의 불빛은
하나둘 꺼지는 중이다.
`.trim(),
    openingScene: `
마지막 종이 울린 지 한참 지났다. 복도에는 아무도 없고, 창밖은 이미 어둑하다.

계단을 오르는 당신의 발소리만 유난히 크게 울린다. 3층으로 이어지는 계단참에서, 저 멀리
음악실 문틈으로 희미한 불빛이 새어 나오는 게 보인다.

그리고 — 아주 희미하게, 피아노 소리가 들린다.
`.trim(),
    characters: [
      {
        id: "hajun",
        name: "하준",
        role: "같은 학교 학생, 먼저 소문을 조사하고 있던 인물",
        personality:
          "호기심이 많고 말이 빠르지만, 막상 위험한 상황 앞에서는 은근히 신중해진다. 농담으로 긴장을 풀려는 습관이 있다.",
      },
    ],
    rules: `
- 사건의 진실을 단번에 밝히지 않는다 — 단서를 조금씩, 대화와 탐색을 통해 드러낸다.
- 초자연적 요소를 다루더라도 과도하게 공포스럽거나 자극적인 묘사로 치닫지 않는다.
- 사용자가 입력하지 않은 행동이나 대사를 사용자 캐릭터의 것으로 임의로 만들어내지 않는다.
`.trim(),
  },
];

export function getStoryById(id: string): Story | undefined {
  return STORIES.find((s) => s.id === id);
}
