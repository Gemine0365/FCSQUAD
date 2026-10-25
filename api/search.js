export default async function handler(req, res) {
  // CORS 헤더 설정 (클라이언트 접근 허용)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { nickname } = req.query;

  if (!nickname) {
    return res.status(400).json({ error: '닉네임을 입력해주세요.' });
  }

  try {
    // Vercel 환경 변수에 저장된 API KEY 사용
    const API_KEY = process.env.NEXON_API_KEY;

    // 1. 닉네임으로 유저 계정 식별자(OUID) 조회
    const userResponse = await fetch(
      `https://open.api.nexon.com/fconline/v1/id?nickname=${encodeURIComponent(nickname)}`,
      {
        headers: {
          'x-nxopen-api-key': API_KEY,
        },
      }
    );

    if (!userResponse.ok) {
      return res.status(userResponse.status).json({ error: '유저를 찾을 수 없습니다.' });
    }

    const userData = await userResponse.json();
    const ouid = userData.ouid;

    // 2. OUID로 역대 최고 등급 조회
    const maxDivisionResponse = await fetch(
      `https://open.api.nexon.com/fconline/v1/user/maxdivision?ouid=${ouid}`,
      {
        headers: {
          'x-nxopen-api-key': API_KEY,
        },
      }
    );
    const maxDivisionData = await maxDivisionResponse.json();

    // 결과 데이터 반환
    return res.status(200).json({
      ouid: ouid,
      nickname: nickname,
      maxDivision: maxDivisionData,
    });
  } catch (error) {
    return res.status(500).json({ error: '서버 내부 에러가 발생했습니다.' });
  }
}
