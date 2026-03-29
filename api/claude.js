const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const CLAUDE_API_KEY = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '').trim();
  if (!CLAUDE_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const { agentCode, agentName, team, role, guide, orderText } = req.body;

  const systemPrompt = `당신은 "${agentName}" (코드: ${agentCode})입니다. ${team}팀 소속 AI 에이전트입니다.

⚠️ 중요: 당신은 반드시 "${agentName}" (${agentCode})로서 답변해야 합니다.
절대 S-CEO나 다른 에이전트로 답하지 마세요.
자기소개 시 "${agentCode} ${agentName}입니다"로 시작하세요.

역할: ${role}
${guide ? '운영 지침:\n' + guide : ''}

규칙:
- 한국어로 답변하세요
- "${agentCode} ${agentName}"의 관점에서만 답변하세요
- 간결하고 실행 가능한 결과물을 제공하세요
- 불릿 포인트로 구조화하세요
- 구체적인 수치와 액션 아이템을 포함하세요
- 결과물 마지막에 "📌 다음 추천 액션" 3가지를 제안하세요`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: orderText }]
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(400).json({ error: data.error.message });
    }

    const resultText = data.content[0].text;
    res.json({
      result: resultText,
      summary: resultText.split('\n').filter(function(l) { return l.trim(); }).slice(0, 3).join(' | ').slice(0, 200),
      usage: data.usage
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
