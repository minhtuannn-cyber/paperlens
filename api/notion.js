// Vercel Serverless Function — Proxies to Notion API (CommonJS)
module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-notion-token');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const notionPath = req.query.p;
    if (!notionPath) {
        return res.status(400).json({ error: 'Missing ?p= query param' });
    }

    const token = req.headers['x-notion-token'];
    if (!token) {
        return res.status(401).json({ error: 'Missing x-notion-token header' });
    }

    const notionUrl = `https://api.notion.com/v1/${notionPath}`;

    try {
        const fetchOpts = {
            method: req.method === 'GET' ? 'GET' : (req.body?._method || req.method),
            headers: {
                'Authorization': `Bearer ${token}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json',
            },
        };

        if (req.method !== 'GET' && req.body) {
            fetchOpts.body = JSON.stringify(req.body);
        }

        const notionRes = await fetch(notionUrl, fetchOpts);
        const data = await notionRes.json();
        return res.status(notionRes.status).json(data);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
