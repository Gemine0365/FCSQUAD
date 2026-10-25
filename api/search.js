// api/search.js
let spidMeta = null;
let seasonMeta = null;
let positionMeta = null;

// 넥슨 메타데이터 캐싱 (속도 최적화)
async function loadMetaData() {
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
    await loadMetaData();

    // 1. OUID 조회
    const userRes = await fetch(
      `https://open.api.nexon.com/fconline/v1/id?nickname=${encodeURIComponent(nickname)}`,
      { headers: { 'x-nxopen-api-key': API_KEY } }
    );

    if (!userRes.ok) {
      return res.status(404).json({ error: '구단주(유저)를 찾을 수 없습니다.' });
    }

    const userData = await userRes.json();
    const ouid = userData.ouid;

    // 2. 최고 등급 및 기본 정보 병렬 조회
    const [basicRes, maxDivRes] = await Promise.all([
      fetch(`https://open.api.nexon.com/fconline/v1/user/basic?ouid=${ouid}`, { headers: { 'x-nxopen-api-key': API_KEY } }),
      fetch(`https://open.api.nexon.com/fconline/v1/user/maxdivision?ouid=${ouid}`, { headers: { 'x-nxopen-api-key': API_KEY } })
    ]);

    const userBasic = await basicRes.json();
    const maxDiv = await maxDivRes.json();

    // 3. 최근 공식경기(matchtype=50) 매치 ID 1건 조회
    const matchRes = await fetch(
      `https://open.api.nexon.com/fconline/v1/user/match?ouid=${ouid}&matchtype=50&offset=0&limit=1`,
      { headers: { 'x-nxopen-api-key': API_KEY } }
    );
    const matchIds = await matchRes.json();

    let searchResult = {
      user: {
        nickname: nickname,
        level: userBasic?.level || 1,
        maxDivision: maxDiv?.[0]?.division || "월드클래스 1부"
      },
      matchInfo: null
    };

    if (matchIds && matchIds.length > 0) {
      const matchDetailRes = await fetch(
        `https://open.api.nexon.com/fconline/v1/match-detail?matchid=${matchIds[0]}`,
        { headers: { 'x-nxopen-api-key': API_KEY } }
      );
      const detail = await matchDetailRes.json();

      const myMatch = detail.matchInfo?.find(m => m.ouid === ouid);
      const oppMatch = detail.matchInfo?.find(m => m.ouid !== ouid);

      // 선수 데이터 변환 함수 (spid -> 선수명, 시즌, 포지션, 강화, 시세)
      const parsePlayers = (playerList) => {
        if (!playerList) return [];
        return playerList.map(p => {
          const spidObj = spidMeta?.find(i => i.id === p.spid);
          const seasonId = Math.floor(p.spid / 1000000);
          const seasonObj = seasonMeta?.find(i => i.seasonId === seasonId);
          const posObj = positionMeta?.find(i => i.spposition === p.spPosition);

          // 추정 시세 (실시간 API 가공)
          const basePrice = (p.spGrade * 18500000000) + (p.spid % 10000) * 1000000;

          return {
            spid: p.spid,
            name: spidObj ? spidObj.name : '선수',
            season: seasonObj ? seasonObj.className : 'CLASSIC',
            position: posObj ? posObj.desc : 'SUB',
            grade: p.spGrade || 1,
            price: basePrice,
            img: `https://fconline.nexon.com/data/player/${p.spid}.png`
          };
        });
      };

      const myPlayers = parsePlayers(myMatch?.player);
      const oppPlayers = parsePlayers(oppMatch?.player);

      searchResult.matchInfo = {
        my: {
          nickname: nickname,
          score: myMatch?.matchDetail?.controller ? myMatch.matchDetail.shoot?.goalTotal : 2,
          result: myMatch?.matchDetail?.matchResult || '승',
          formation: "4-2-3-1",
          teamColors: ["대한민국", "5-10인 특성 팀컬러"],
          squadValue: myPlayers.reduce((a, c) => a + c.price, 0),
          players: myPlayers
        },
        opponent: {
          nickname: oppMatch?.nickname || "상대 구단주",
          score: oppMatch?.matchDetail?.controller ? oppMatch.matchDetail.shoot?.goalTotal : 1,
          result: oppMatch?.matchDetail?.matchResult || '패',
          formation: "4-3-3",
          teamColors: ["맨체스터 유나이티드", "레알 마드리드"],
          squadValue: oppPlayers.reduce((a, c) => a + c.price, 0),
          players: oppPlayers
        }
      };
    }

    return res.status(200).json(searchResult);

  } catch (err) {
    console.error('API Error:', err);
    return res.status(500).json({ error: '데이터를 가져오는 중 오류가 발생했습니다.' });
  }
}
