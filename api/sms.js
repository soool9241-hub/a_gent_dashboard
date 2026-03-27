const crypto = require('crypto');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SOLAPI_KEY = (process.env.SOLAPI_KEY || '').trim();
  const SOLAPI_SECRET = (process.env.SOLAPI_SECRET || '').trim();
  const SENDER_PHONE = (process.env.SENDER_PHONE || '01085319531').trim();

  if (!SOLAPI_KEY || !SOLAPI_SECRET) {
    return res.status(500).json({ error: 'Solapi credentials not set' });
  }

  const { to, text } = req.body;

  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString('hex');
  const signature = crypto.createHmac('sha256', SOLAPI_SECRET).update(date + salt).digest('hex');

  try {
    const response = await fetch('https://api.solapi.com/messages/v4/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `HMAC-SHA256 apiKey=${SOLAPI_KEY}, date=${date}, salt=${salt}, signature=${signature}`
      },
      body: JSON.stringify({
        message: { to, from: SENDER_PHONE, text }
      })
    });

    const data = await response.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
