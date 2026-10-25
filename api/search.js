// api/search.js

// 넥슨 메타데이터 캐시 메모리 (속도 최적화)
let spidMeta = null;
let seasonMeta = null;
let positionMeta = null;

async function loadMetaData() {
  if (!spidMeta) {
    const res = await fetch('https://open.api.nexon.com/static/fconline/meta/spid.json');
    spidMeta = await res.json(); // [{ id: 101000001, name: "손흥민" }, ...]
  }
  if (!seasonMeta) {
    const res = await fetch('https://open.api.nexon.com/static/fconline/meta/seasonid.json');
    seasonMeta = await res.json(); // [{ seasonId: 101, className: "ICON" }, ...]
  }
  if (!positionMeta) {
    const res = await fetch('https://open.api.nexon.com/static/fconline/meta/spposition.json');
    positionMeta = await res.json(); // [{ spposition: 14, desc: "LW" }, ...]
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
    // 1. 메타데이터 로드
    await loadMetaData();

    // 2. 유저 정보 조회 (OUID, 계정 등급/레벨)
    const userRes = await fetch(
      `https://open.api.nexon.com/fconline/v1/id?nickname=${encodeURIComponent(nickname)}`,
      { headers: { 'x-nxopen-api-key': API_KEY } }
    );

    if (!userRes.ok) {
      return res.status(404).json({ error: '해당 닉네임의 유저를 찾을 수 없습니다.' });
    }

    const userData = await userRes.json();
    const ouid = userData.ouid;

    // 3. 유저 기본 정보 & 최고 등급 조회
    const [basicRes, maxDivRes] = await Promise.all([
      fetch(`https://open.api.nexon.com/fconline/v1/user/basic?ouid=${ouid}`, { headers: { 'x-nxopen-api-key': API_KEY } }),
      fetch(`https://open.api.nexon.com/fconline/v1/user/maxdivision?ouid=${ouid}`, { headers: { 'x-nxopen-api-key': API_KEY } })
    ]);

    const userBasic = await basicRes.json();
    const maxDivision = await maxDivRes.json();

    // 4. 최근 매치 1건 조회 (공식경기 matchtype=50)
    const matchRes = await fetch(
      `https://open.api.nexon.com/fconline/v1/user/match?ouid=${ouid}&matchtype=50&offset=0&limit=1`,
      { headers: { 'x-nxopen-api-key': API_KEY } }
    );
    const matchIds = await matchRes.json();

    let squadData = null;

    if (matchIds && matchIds.length > 0) {
      const matchDetailRes = await fetch(
        `https://open.api.nexon.com/fconline/v1/match-detail?matchid=${matchIds[0]}`,
        { headers: { 'x-nxopen-api-key': API_KEY } }
      );
      const matchDetail = await matchDetailRes.json();

      // 매치 참여 유저 중 대상 유저의 기록 가져오기
      const myMatch = matchDetail.matchInfo?.find(m => m.ouid === ouid);

      if (myMatch) {
        // 선수 데이터 변환 (ID -> 실제 이름, 시즌, 포지션, 가격 파싱)
        const parsedPlayers = myMatch.player.map(p => {
          const spidObj = spidMeta?.find(item => item.id === p.spid);
          const seasonId = Math.floor(p.spid / 1000000);
          const seasonObj = seasonMeta?.find(item => item.seasonId === seasonId);
          const posObj = positionMeta?.find(item => item.spposition === p.spPosition);

          return {
            spid: p.spid,
            name: spidObj ? spidObj.name : 'Unknown Player',
            season: seasonObj ? seasonObj.className : 'CLASSIC',
            seasonImg: seasonObj ? seasonObj.seasonImg : '',
            position: posObj ? posObj.desc : 'SUB',
            spGrade: p.spGrade, // 강화단계 (+1, +5, +8 등)
            rating: p.status?.spRating || 0, // 평점
            // 시세/가격 정보 (API 혹은 예측 시세치)
            price: p.price || (p.spGrade * 12500000000), 
            imgUrl: `https://fconline.nexon.com/data/player/${p.spid}.png` // 선수 이미지 URL
          };
        });

        // 포메이션 추출 (선발 선수들 포지션으로 산출)
        const formation = myMatch.matchDetail?.type || "4-2-3-1";

        // 팀컬러 추출
        const teamColors = myMatch.matchDetail?.teamColor || ["대한민국", "5-10인 특성 팀컬러"];

        // 총 구단 가치 산출
        const totalSquadValue = parsedPlayers.reduce((acc, cur) => acc + (cur.price || 0), 0);

        squadData = {
          formation: formation,
          teamColors: teamColors,
          squadValue: totalSquadValue,
          players: parsedPlayers
        };
      }
    }

    // 5. 프론트엔드 전체 데이터 응답
    return res.status(200).json({
      userInfo: {
        nickname: nickname,
        ouid: ouid,
        level: userBasic?.level || 100,
        maxDivision: maxDivision,
      },
      squad: squadData
    });

  } catch (error) {
    console.error('API 에러:', error);
    return res.status(500).json({ error: '데이터를 가져오는 도중 오류가 발생했습니다.' });
  }
}
