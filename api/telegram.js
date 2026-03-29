const https = require('https');

const SB_URL = (process.env.SUPABASE_URL || 'https://pcgzuvnvcxoobkcluksz.supabase.co').replace(/\/$/, '').trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();
const TG_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TG_CHAT = (process.env.TELEGRAM_CHAT_ID || '').trim();
const CLAUDE_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();

function httpReq(url, options, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opt = {
      hostname: u.hostname, path: u.pathname + u.search,
      method: options.method || 'GET', headers: options.headers || {}
    };
    const req = https.request(opt, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(d); } });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function sbFetch(path) {
  return httpReq(SB_URL + '/rest/v1/' + path, {
    headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' }
  });
}

async function sendTG(chatId, text, opts) {
  const payload = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
  if (opts) Object.assign(payload, opts);
  return httpReq('https://api.telegram.org/bot' + TG_TOKEN + '/sendMessage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }
  }, JSON.stringify(payload));
}

async function sendDocument(chatId, filename, content) {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + Date.now();
    const body = Buffer.concat([
      Buffer.from(
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="chat_id"\r\n\r\n' + chatId + '\r\n' +
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="document"; filename="' + filename + '"\r\n' +
        'Content-Type: text/csv\r\n\r\n'
      ),
      Buffer.from(content, 'utf-8'),
      Buffer.from('\r\n--' + boundary + '--\r\n')
    ]);
    const u = new URL('https://api.telegram.org/bot' + TG_TOKEN + '/sendDocument');
    const req = https.request({
      hostname: u.hostname, path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(d); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// CSV 생성 헬퍼
function leadsToCSV(leads) {
  const units = { pension: 'A-달팽이아지트', cnc: 'B-스토리팜', automation: 'C-AI자동화', webdev: 'D-웹개발' };
  const BOM = '\uFEFF';
  const headers = ['No','상호명','전화번호','주소','홈페이지','사이트상태','업종태그','니즈','등급','스코어','비고(상세)','수집일'];
  let csv = BOM + headers.join(',') + '\n';
  leads.forEach((l, i) => {
    const row = [
      i+1, l.company||l.name||'', l.phone||'', l.address||'',
      l.website_url||'없음', l.website_status||'', (l.tags||[]).join('/'),
      l.need||'', l.grade||'', l.score||0,
      (l.notes||'').replace(/\n/g,' | '),
      l.created_at ? l.created_at.split('T')[0] : ''
    ].map(v => '"' + String(v).replace(/"/g, '""') + '"');
    csv += row.join(',') + '\n';
  });
  return csv;
}

// 명령어 처리
async function handleCommand(chatId, text) {
  const cmd = text.trim();

  // /현황 — 전체 요약
  if (cmd === '/현황' || cmd === '/status' || cmd === '/start') {
    const leads = await sbFetch('leads?select=business_unit,stage,score,source&order=created_at.desc');
    const arr = Array.isArray(leads) ? leads : [];
    if (arr.length === 0) return sendTG(chatId, '📊 아직 수집된 가망고객이 없습니다.\n크롤링을 먼저 실행해주세요.');

    const byUnit = {};
    arr.forEach(l => { byUnit[l.business_unit] = (byUnit[l.business_unit] || 0) + 1; });
    const hot = arr.filter(l => l.score >= 50).length;
    const warm = arr.filter(l => l.score >= 20 && l.score < 50).length;
    const cold = arr.filter(l => l.score < 20).length;

    const unitNames = { pension: '🏡A-펜션', cnc: '🔧B-CNC', automation: '🤖C-자동화', webdev: '💻D-웹개발' };
    let msg = '📊 *가망고객 현황*\n\n';
    msg += '총 *' + arr.length + '명*\n';
    msg += '🔥 Hot: ' + hot + '명 | 🟡 Warm: ' + warm + '명 | 🔵 Cold: ' + cold + '명\n\n';
    msg += '*사업부별:*\n';
    Object.keys(byUnit).forEach(u => {
      msg += (unitNames[u] || u) + ': ' + byUnit[u] + '명\n';
    });
    msg += '\n📌 명령어:\n/hot — 핫 리드\n/오늘 — 오늘 수집\n/csv — 엑셀 다운로드';
    return sendTG(chatId, msg);
  }

  // /hot — 핫 리드 목록
  if (cmd === '/hot') {
    const leads = await sbFetch('leads?score=gte.50&select=name,phone,company,score,business_unit,need&order=score.desc&limit=10');
    const arr = Array.isArray(leads) ? leads : [];
    if (arr.length === 0) return sendTG(chatId, '🔥 핫 리드가 아직 없습니다.');

    let msg = '🔥 *핫 리드 TOP ' + arr.length + '*\n\n';
    arr.forEach((l, i) => {
      msg += (i+1) + '. *' + (l.name || l.company || '?') + '* (점수: ' + l.score + ')\n';
      msg += '   📞 ' + (l.phone || '없음') + '\n';
      msg += '   💡 ' + (l.need || '-') + '\n\n';
    });
    return sendTG(chatId, msg);
  }

  // /오늘 — 오늘 수집된 리드
  if (cmd === '/오늘' || cmd === '/today') {
    const today = new Date().toISOString().split('T')[0];
    const leads = await sbFetch('leads?created_at=gte.' + today + 'T00:00:00&select=name,phone,company,score,business_unit,source&order=score.desc');
    const arr = Array.isArray(leads) ? leads : [];
    if (arr.length === 0) return sendTG(chatId, '📅 오늘 수집된 가망고객이 없습니다.');

    let msg = '📅 *오늘 수집: ' + arr.length + '건*\n\n';
    const unitNames = { pension: '🏡A', cnc: '🔧B', automation: '🤖C', webdev: '💻D' };
    arr.slice(0, 15).forEach((l, i) => {
      msg += (i+1) + '. ' + (unitNames[l.business_unit] || '') + ' *' + (l.name || l.company || '?') + '* (' + l.score + '점)\n';
      msg += '   📞 ' + (l.phone || '-') + ' | ' + (l.source || '') + '\n';
    });
    if (arr.length > 15) msg += '\n... 외 ' + (arr.length - 15) + '건';
    return sendTG(chatId, msg);
  }

  // /csv — CSV 파일 전송
  if (cmd === '/csv' || cmd === '/엑셀') {
    try {
      const leads = await sbFetch('leads?select=name,company,phone,address,website_url,website_status,tags,need,grade,score,headcount,notes,created_at&order=score.desc');
      const arr = Array.isArray(leads) ? leads : [];
      if (arr.length === 0) return sendTG(chatId, '📋 다운로드할 데이터가 없습니다.');

      const csv = leadsToCSV(arr);
      const filename = 'leads_' + new Date().toISOString().split('T')[0] + '.csv';
      const result = await sendDocument(chatId, filename, csv);
      if (result && result.ok) {
        return sendTG(chatId, '📋 *' + arr.length + '건* 데이터를 전송했습니다.');
      } else {
        return sendTG(chatId, '❌ 파일 전송 실패: ' + JSON.stringify(result).slice(0, 100));
      }
    } catch(e) {
      return sendTG(chatId, '❌ CSV 생성 오류: ' + e.message);
    }
  }

  // /수집 — 수동 크롤링 트리거
  if (cmd === '/수집' || cmd === '/crawl') {
    await sendTG(chatId, '🔄 크롤링을 시작합니다... 잠시 기다려주세요.');
    try {
      const host = process.env.VERCEL_URL || 'imsol-dashboard.vercel.app';
      const result = await httpReq('https://' + host + '/api/crawl', {});
      if (result.success) {
        return sendTG(chatId, '✅ 크롤링 완료!\n📦 수집: ' + result.collected + '건\n🆕 신규: ' + (result.new || 0) + '건');
      } else {
        return sendTG(chatId, '❌ 크롤링 오류: ' + (result.error || 'unknown'));
      }
    } catch(e) {
      return sendTG(chatId, '❌ 크롤링 실패: ' + e.message);
    }
  }

  // /활용 — 데이터 활용 가이드
  if (cmd === '/활용' || cmd === '/guide') {
    return sendTG(chatId,
      '📖 *수집 데이터 활용 가이드*\n\n' +
      '*수집 항목:* 상호명, 전화번호, 주소, 홈페이지, 니즈, 점수\n\n' +
      '🏡 *A팀 (펜션)* — 여행사/기업연수 업체\n' +
      '→ "단체 숙박 패키지" 제안 전화\n' +
      '→ 기업 HR담당자에게 워크숍 제안\n\n' +
      '🔧 *B팀 (CNC공방)* — 카페/식당/신규매장\n' +
      '→ "간판+인테리어소품 세트" 제안\n' +
      '→ 신규오픈 매장에 오픈 패키지 영업\n\n' +
      '🤖 *C팀 (AI자동화)* — 소상공인/창업자\n' +
      '→ "SNS 자동 포스팅" 무료체험 제안\n' +
      '→ 홈페이지 없는 곳에 D팀 연계 패키지\n\n' +
      '💻 *D팀 (웹개발)* — 홈페이지 없는 업체\n' +
      '→ 홈페이지 없는 곳: "무료 진단+제작 견적"\n' +
      '→ 있는 곳: "모바일 최적화 무료 체크"\n\n' +
      '📊 *스코어 기준:*\n' +
      '20점↑ = 홈페이지 없음 (핫)\n' +
      '15점 = 유력 타겟\n' +
      '5점 = 일반 리드\n' +
      '50점↑ = 즉시 연락!\n\n' +
      '📌 *활용 순서:*\n' +
      '1. /hot 으로 고점수 리드 확인\n' +
      '2. /csv 로 엑셀 다운 → 팀에 배분\n' +
      '3. 전화/SMS 영업 시작\n' +
      '4. 반응 있으면 점수 올려서 추적'
    );
  }

  // /도움 — 도움말
  if (cmd === '/도움' || cmd === '/help') {
    return sendTG(chatId,
      '🤖 *가망고객 수집봇 명령어*\n\n' +
      '/현황 — 전체 현황 요약\n' +
      '/hot — 핫 리드 목록\n' +
      '/오늘 — 오늘 수집 리드\n' +
      '/csv — CSV 파일 다운로드\n' +
      '/수집 — 수동 크롤링 실행\n' +
      '/활용 — 데이터 활용 가이드\n' +
      '/도움 — 이 도움말'
    );
  }

  // Claude AI 대화 (명령어가 아닌 일반 메시지)
  if (CLAUDE_KEY) {
    try {
      // 가망고객 현황 컨텍스트 가져오기
      const leads = await sbFetch('leads?select=business_unit,stage,score,source&order=created_at.desc');
      const arr = Array.isArray(leads) ? leads : [];
      const hot = arr.filter(l => l.score >= 50).length;
      const warm = arr.filter(l => l.score >= 20 && l.score < 50).length;

      const systemPrompt = '너는 "S-CEO 비서봇"이야. 가망고객 수집 시스템을 운영하는 AI 비서야.\n'
        + '현재 DB 현황: 총 ' + arr.length + '명 (Hot: ' + hot + ', Warm: ' + warm + ', Cold: ' + (arr.length - hot - warm) + ')\n'
        + '사업부: A-달팽이아지트(펜션), B-스토리팜(CNC공방), C-AI자동화, D-웹개발\n'
        + '한국어로 간결하고 실용적으로 답변해. 이모지 적절히 사용.\n'
        + '가망고객, 마케팅, 영업, 사업 관련 질문에 특히 전문적으로 답변해.\n'
        + '명령어 안내가 필요하면: /현황, /hot, /오늘, /csv, /수집, /도움';

      const claudeResp = await httpReq('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CLAUDE_KEY,
          'anthropic-version': '2023-06-01'
        }
      }, JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: cmd }]
      }));

      if (claudeResp.content && claudeResp.content[0]) {
        const reply = claudeResp.content[0].text;
        return sendTG(chatId, reply);
      }
    } catch(e) {
      console.error('Claude API error:', e);
    }
  }

  // Claude 키 없을 때 기본 응답
  return sendTG(chatId,
    '안녕하세요! 가망고객 수집봇입니다 🤖\n/도움 을 입력하면 명령어를 확인할 수 있습니다.'
  );
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: 웹훅 상태 확인
  if (req.method === 'GET') {
    return res.json({ status: 'Telegram bot webhook active', commands: ['/현황', '/hot', '/오늘', '/csv', '/수집', '/도움'] });
  }

  // POST: 텔레그램 웹훅
  if (req.method === 'POST') {
    try {
      const update = req.body;
      if (!update || !update.message || !update.message.text) {
        return res.json({ ok: true });
      }

      const chatId = update.message.chat.id;
      const text = update.message.text;

      await handleCommand(String(chatId), text);
      return res.json({ ok: true });
    } catch(e) {
      console.error('Telegram webhook error:', e);
      return res.json({ ok: true, error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
