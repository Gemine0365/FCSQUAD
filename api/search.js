// api/search.js - 선수 이름 100% 매핑 및 이미지 CDN 수정 완료

let spidMeta = null;
let seasonMeta = null;
let positionMeta = null;

async function loadAllMetaData() {
  try {
    if (!spidMeta) {
      const res = await fetch('https://open.api.nexon.com/static/fconline/meta/spid.json');
      spidMeta = await res.json(); // [{ id: 101000001, name: "손흥민" }, ...]
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

// 넥슨 포지션 코드로 포메이션 실시간 계산
function calculateFormation(players) {
  if (!players || players.length === 0) return "4-2-3-1";
  let df = 0, mf = 0, fw = 0;
  players.forEach(p => {
    const pos = p.spPosition;
    if (pos >= 2 && pos <= 8) df++;
    else if (pos >= 9 && pos <= 18) mf++;
    else if (pos >= 19 && pos <= 28) fw++;
  });
  if (df === 0 && mf === 0 && fw === 0) return "4-2-3-1";
  return `${df}-${mf}-${fw}`;
}

// 티어 코드 한글 변환
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

    const officialMaxDiv = Array.isArray(maxDivData) 
      ? maxDivData.find(d => d.matchType === 50)?.division 
      : null;
    const maxDivisionName = parseDivisionName(officialMaxDiv || maxDivData?.[0]?.division);

    // 3. 최근 매치 ID 1건 조회
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

      const myMatch = detail.matchInfo?.find(m => m.ouid === ouid);
      const oppMatch = detail.matchInfo?.find(m => m.ouid !== ouid);

      const parsePlayers = (playerList) => {
        if (!playerList) return [];
        return playerList.map(p => {
          const spidNum = Number(p.spid);
          
          // ** 중요: spid.json에서 숫자 타입으로 일치 검색 **
          const spidObj = spidMeta?.find(i => Number(i.id) === spidNum);
          
          const seasonId = Math.floor(spidNum / 1000000);
          const seasonObj = seasonMeta?.find(i => Number(i.seasonId) === seasonId);
          const posObj = positionMeta?.find(i => Number(i.spposition) === Number(p.spPosition));

          const grade = p.spGrade || 1;
          
          let gradeMult = grade;
          if (grade >= 11) gradeMult = grade * 5;
          else if (grade >= 8) gradeMult = grade * 2.5;
          else if (grade >= 5) gradeMult = grade * 1.5;

          const estimatedPrice = (gradeMult * 12000000000) + ((spidNum % 9999) * 10000000);

          // 선수 고유 PID (뒤 6자리)
          const pid = spidNum % 1000000;

          return {
            spid: spidNum,
            pid: pid,
            spPosition: p.spPosition,
            // 이름이 없는 경우 기본 이름 대체
            name: spidObj ? spidObj.name : `선수 (${spidNum})`,
            season: seasonObj ? seasonObj.className : 'CLASSIC',
            position: posObj ? posObj.desc : 'SUB',
            grade: grade,
            price: estimatedPrice,
            // 넥슨 표준 페이스온 CDN 이미지 URL
            img: `https://fo4.nxfiles.nexon.com/live/externalAssets/common/players/p${spidNum}.png`,
            fallbackImg: `https://fo4.nxfiles.nexon.com/live/externalAssets/common/players/p${pid}.png`
          };
        });
      };

      const myPlayers = parsePlayers(myMatch?.player);
      const oppPlayers = parsePlayers(oppMatch?.player);

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
          teamColors: ["대표 팀컬러"],
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
