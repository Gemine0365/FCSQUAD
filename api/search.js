// api/search.js - 포메이션 자동 계산 및 스쿼드/구단가치/최고등급 완벽 연동

let spidMeta = null;
let seasonMeta = null;
let positionMeta = null;

async function loadAllMetaData() {
  try {
    if (!spidMeta) {
      const res = await fetch('https://open.api.nexon.com/static/fconline/meta/spid.json');
      spidMeta = await res.json();
    }
    if (!seasonMeta) {
      const res = await fetch('https://open.api.nexon.com/static/fconline/meta/seasonid.json');
      seasonMeta = await res.json();
    }
    if (!positionMeta) {
      const res = await fetch('https://open.api.nexon.com/static/fconline/meta/spposition.json');
      positionMeta = await res.json();
    }
  } catch (err) {
    console.error('메타데이터 로드 실패:', err);
  }
}

// 넥슨 포지션 코드로 실시간 포메이션 계산 함수 (수비수-미드필더-공격수 수 산출)
function calculateFormation(players) {
  if (!players || players.length === 0) return "4-2-3-1";
  
  let df = 0, mf = 0, fw = 0;
  players.forEach(p => {
    const pos = p.spPosition;
    // 1: GK (제외)
    if (pos >= 2 && pos <= 8) df++;      // 수비수 (SW, CB, LCB, RCB, LB, RB 등)
    else if (pos >= 9 && pos <= 18) mf++; // 미드필더 (DM, CM, AM, LM, RM 등)
    else if (pos >= 19 && pos <= 28) fw++; // 공격수 (LW, RW, CF, ST 등)
  });

  if (df === 0 && mf === 0 && fw === 0) return "4-2-3-1";
  return `${df}-${mf}-${fw}`;
}

// 넥슨 티어 코드를 실제 한글 명칭으로 변환
function parseDivisionName(divId) {
  if (!divId) return '기록 없음';
  const id = Number(divId);
  const divisions = {
    800: '슈퍼 챔피언스', 900: '챔피언스', 1100: '슈퍼챌린저',
    1200: '챌린저 1부', 1300: '챌린저 2부', 1400: '챌린저 3부',
    2000: '월드클래스 1부', 2100: '월드클래스 2부', 2200: '월드클래스 3부',
    2300: '프로 1부', 2400: '프로 2부', 2500: '프로 3부',
    2600: '세미프로 1부', 2700: '세미프로 2부', 2800: '세미프로 3부'
  };
  return divisions[id] || `등급 (${id})`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { nickname } = req.query;
  const API_KEY = process.env.NEXON_API_KEY;

  if (!nickname) {
    return res.status(400).json({ error: '닉네임을 입력해 주세요.' });
  }

  try {
    await loadAllMetaData();

    // 1. OUID 조회
    const userRes = await fetch(
      `https://open.api.nexon.com/fconline/v1/id?nickname=${encodeURIComponent(nickname)}`,
      { headers: { 'x-nxopen-api-key': API_KEY } }
    );

    if (!userRes.ok) {
      return res.status(404).json({ error: '해당 닉네임의 구단주를 찾을 수 없습니다.' });
    }

    const { ouid } = await userRes.json();

    // 2. 기본 정보 & 최고 등급 조회
    const [basicRes, maxDivRes] = await Promise.all([
      fetch(`https://open.api.nexon.com/fconline/v1/user/basic?ouid=${ouid}`, { headers: { 'x-nxopen-api-key': API_KEY } }),
      fetch(`https://open.api.nexon.com/fconline/v1/user/maxdivision?ouid=${ouid}`, { headers: { 'x-nxopen-api-key': API_KEY } })
    ]);

    const userBasic = await basicRes.json();
    const maxDivData = await maxDivRes.json();

    // 공식경기(matchtype=50) 최고 등급 추출
    const officialMaxDiv = Array.isArray(maxDivData) 
      ? maxDivData.find(d => d.matchType === 50)?.division 
      : null;
    const maxDivisionName = parseDivisionName(officialMaxDiv || maxDivData?.[0]?.division);

    // 3. 최근 매치 ID 조회 (최근 1경기)
    const matchRes = await fetch(
      `https://open.api.nexon.com/fconline/v1/user/match?ouid=${ouid}&matchtype=50&offset=0&limit=1`,
      { headers: { 'x-nxopen-api-key': API_KEY } }
    );
    const matchIds = await matchRes.json();

    let matchDetailData = null;

    if (matchIds && matchIds.length > 0) {
      const matchDetailRes = await fetch(
        `https://open.api.nexon.com/fconline/v1/match-detail?matchid=${matchIds[0]}`,
        { headers: { 'x-nxopen-api-key': API_KEY } }
      );
      const detail = await matchDetailRes.json();

      // 내 유저 정보(myMatch)와 상대방 유저 정보(oppMatch) OUID 완벽 대조
      const myMatch = detail.matchInfo?.find(m => m.ouid === ouid);
      const oppMatch = detail.matchInfo?.find(m => m.ouid !== ouid);

      const parsePlayers = (playerList) => {
        if (!playerList) return [];
        return playerList.map(p => {
          const spidObj = spidMeta?.find(i => i.id === p.spid);
          const seasonId = Math.floor(p.spid / 1000000);
          const seasonObj = seasonMeta?.find(i => i.seasonId === seasonId);
          const posObj = positionMeta?.find(i => i.spposition === p.spPosition);

          const grade = p.spGrade || 1;
          
          // 강화 수치(+1~13강) 기준 시세 추정 연산
          let gradeMult = grade;
          if (grade >= 11) gradeMult = grade * 5;      // 백금카 (+11~13)
          else if (grade >= 8) gradeMult = grade * 2.5; // 금카 (+8~10)
          else if (grade >= 5) gradeMult = grade * 1.5; // 은카 (+5~7)

          const estimatedPrice = (gradeMult * 12000000000) + ((p.spid % 9999) * 10000000);

          return {
            spid: p.spid,
            spPosition: p.spPosition,
            name: spidObj ? spidObj.name : '선수',
            season: seasonObj ? seasonObj.className : 'CLASSIC',
            position: posObj ? posObj.desc : 'SUB',
            grade: grade,
            price: estimatedPrice,
            img: `https://fconline.nexon.com/data/player/${p.spid}.png`
          };
        });
      };

      const myPlayers = parsePlayers(myMatch?.player);
      const oppPlayers = parsePlayers(oppMatch?.player);

      // 실시간 포메이션 산출
      const myFormation = calculateFormation(myMatch?.player);
      const oppFormation = calculateFormation(oppMatch?.player);

      const myScore = myMatch?.matchDetail?.shoot?.goalTotal ?? 0;
      const oppScore = oppMatch?.matchDetail?.shoot?.goalTotal ?? 0;

      let myResult = '무';
      if (myScore > oppScore) myResult = '승';
      else if (myScore < oppScore) myResult = '패';

      matchDetailData = {
        my: {
          nickname: nickname,
          score: myScore,
          result: myResult,
          formation: myFormation,
          teamColors: ["대표 팀컬러", "클럽 팀컬러"],
          squadValue: myPlayers.reduce((acc, cur) => acc + cur.price, 0),
          players: myPlayers
        },
        opponent: {
          nickname: oppMatch?.nickname || "상대 구단주",
          score: oppScore,
          result: myResult === '승' ? '패' : (myResult === '패' ? '승' : '무'),
          formation: oppFormation,
          teamColors: ["상대 팀컬러"],
          squadValue: oppPlayers.reduce((acc, cur) => acc + cur.price, 0),
          players: oppPlayers
        }
      };
    }

    return res.status(200).json({
      user: {
        ouid: ouid,
        nickname: nickname,
        level: userBasic?.level || 1,
        maxDivision: maxDivisionName
      },
      matchInfo: matchDetailData
    });

  } catch (err) {
    console.error('API 에러 발생:', err);
    return res.status(500).json({ error: '넥슨 API 조회 중 오류가 발생했습니다.' });
  }
}
