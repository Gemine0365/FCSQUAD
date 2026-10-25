// api/search.js - 넥슨 FC 온라인 오픈 API 통합 및 +13강(백금카) 지원 모듈

let spidMeta = null;
let seasonMeta = null;
let positionMeta = null;
let divisionMeta = null;
let matchTypeMeta = null;

// 1. 넥슨 오픈 API 메타데이터 캐싱 로드
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
    if (!divisionMeta) {
      const res = await fetch('https://open.api.nexon.com/static/fconline/meta/division.json');
      divisionMeta = await res.json();
    }
    if (!matchTypeMeta) {
      const res = await fetch('https://open.api.nexon.com/static/fconline/meta/matchtype.json');
      matchTypeMeta = await res.json();
    }
  } catch (err) {
    console.error('메타데이터 캐싱 실패:', err);
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
    await loadAllMetaData();

    // [API 1] 닉네임으로 유저 식별자(OUID) 실시간 조회
    const userRes = await fetch(
      `https://open.api.nexon.com/fconline/v1/id?nickname=${encodeURIComponent(nickname)}`,
      { headers: { 'x-nxopen-api-key': API_KEY } }
    );

    if (!userRes.ok) {
      return res.status(404).json({ error: '해당 닉네임의 구단주를 찾을 수 없습니다.' });
    }

    const { ouid } = await userRes.json();

    // [API 2, 3, 4] 유저 기본 정보, 최고 등급, 이적시장 거래 기록 병렬 조회
    const [basicRes, maxDivRes, tradeRes] = await Promise.all([
      fetch(`https://open.api.nexon.com/fconline/v1/user/basic?ouid=${ouid}`, { headers: { 'x-nxopen-api-key': API_KEY } }),
      fetch(`https://open.api.nexon.com/fconline/v1/user/maxdivision?ouid=${ouid}`, { headers: { 'x-nxopen-api-key': API_KEY } }),
      fetch(`https://open.api.nexon.com/fconline/v1/user/trade?ouid=${ouid}&tradetype=buy&offset=0&limit=10`, { headers: { 'x-nxopen-api-key': API_KEY } })
    ]);

    const userBasic = await basicRes.json();
    const maxDiv = await maxDivRes.json();
    const tradeHistory = await tradeRes.json();

    // [API 5] 최근 공식경기(matchtype=50) 매치 ID 목록 조회 (최근 5경기)
    const matchRes = await fetch(
      `https://open.api.nexon.com/fconline/v1/user/match?ouid=${ouid}&matchtype=50&offset=0&limit=5`,
      { headers: { 'x-nxopen-api-key': API_KEY } }
    );
    const matchIds = await matchRes.json();

    let detailedMatchList = [];

    // [API 6] 최근 매치 상세 정보 및 슈팅/패스/수비 통계 파싱
    if (matchIds && matchIds.length > 0) {
      for (const matchId of matchIds) {
        const matchDetailRes = await fetch(
          `https://open.api.nexon.com/fconline/v1/match-detail?matchid=${matchId}`,
          { headers: { 'x-nxopen-api-key': API_KEY } }
        );
        const detail = await matchDetailRes.json();

        // 검색 대상 유저(myMatch)와 상대 유저(oppMatch) OUID 매칭
        const myMatch = detail.matchInfo?.find(m => m.ouid === ouid);
        const oppMatch = detail.matchInfo?.find(m => m.ouid !== ouid);

        if (!myMatch) continue;

        // 선수 정보 상세 인코딩 (spid -> 실명, 사진, 포지션, 강화 1~13강, 시세 가중치, 세부 통계)
        const parsePlayers = (playerList) => {
          if (!playerList) return [];
          return playerList.map(p => {
            const spidObj = spidMeta?.find(i => i.id === p.spid);
            const seasonId = Math.floor(p.spid / 1000000);
            const seasonObj = seasonMeta?.find(i => i.seasonId === seasonId);
            const posObj = positionMeta?.find(i => i.spposition === p.spPosition);

            const grade = p.spGrade || 1; // 1강 ~ 13강(백금카) 수용

            // 강화 단계별 시세 가중치 연산 (+11~13강 백금카의 프리미엄 가치 반영)
            let gradeMultiplier = grade;
            if (grade >= 11) {
              gradeMultiplier = grade * 4; // 백금카 가치
            } else if (grade >= 8) {
              gradeMultiplier = grade * 2; // 금카 가치
            }

            const estimatedPrice = p.price || (gradeMultiplier * 18000000000);

            return {
              spid: p.spid,
              name: spidObj ? spidObj.name : '선수',
              season: seasonObj ? seasonObj.className : 'CLASSIC',
              position: posObj ? posObj.desc : 'SUB',
              grade: grade, // 13강까지의 강화 수치 그대로 반환
              price: estimatedPrice,
              img: `https://fconline.nexon.com/data/player/${p.spid}.png`,
              // 개인 세부 실시간 경기 스탯 (평점, 골, 어시스트, 카드리포트 등)
              status: {
                spRating: p.status?.spRating || 0,
                goal: p.status?.goal || 0,
                assist: p.status?.assist || 0,
                passSuccess: p.status?.passSuccess || 0,
                tackle: p.status?.tackle || 0,
                yellowCards: p.status?.yellowCards || 0,
                redCards: p.status?.redCards || 0
              }
            };
          });
        };

        const myPlayers = parsePlayers(myMatch.player);
        const oppPlayers = parsePlayers(oppMatch?.player);

        // 스코어 및 결과 정확하게 산출
        const myScore = myMatch.matchDetail?.shoot?.goalTotal ?? 0;
        const oppScore = oppMatch?.matchDetail?.shoot?.goalTotal ?? 0;

        let myResult = '무';
        if (myScore > oppScore) myResult = '승';
        else if (myScore < oppScore) myResult = '패';

        let oppResult = myResult === '승' ? '패' : (myResult === '패' ? '승' : '무');

        detailedMatchList.push({
          matchId: matchId,
          matchDate: detail.matchDate,
          my: {
            nickname: nickname,
            result: myResult,
            score: myScore,
            possession: myMatch.matchDetail?.possession || 0,
            formation: "4-2-3-1",
            shootStats: myMatch.matchDetail?.shoot || {}, // 슈팅 좌표 포함
            passStats: myMatch.matchDetail?.pass || {},
            defenseStats: myMatch.matchDetail?.defense || {},
            players: myPlayers,
            squadValue: myPlayers.reduce((a, c) => a + c.price, 0)
          },
          opponent: {
            nickname: oppMatch?.nickname || '상대 구단주',
            result: oppResult,
            score: oppScore,
            possession: oppMatch?.matchDetail?.possession || 0,
            formation: "4-3-3",
            shootStats: oppMatch?.matchDetail?.shoot || {},
            passStats: oppMatch?.matchDetail?.pass || {},
            defenseStats: oppMatch?.matchDetail?.defense || {},
            players: oppPlayers,
            squadValue: oppPlayers.reduce((a, c) => a + c.price, 0)
          }
        });
      }
    }

    // 넥슨 오픈 API의 모든 원천 및 가공 데이터 응답 반환
    return res.status(200).json({
      user: {
        ouid: ouid,
        nickname: nickname,
        level: userBasic?.level || 1,
        maxDivision: maxDiv
      },
      tradeHistory: tradeHistory,
      recentMatches: detailedMatchList
    });

  } catch (err) {
    console.error('넥슨 통합 API 응답 실패:', err);
    return res.status(500).json({ error: '넥슨 오픈 API 데이터를 가져오는 중 오류가 발생했습니다.' });
  }
}
