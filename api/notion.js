// Vercel Serverless Function — Proxies requests to Notion API
// This avoids CORS issues by routing browser → Vercel → Notion

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-notion-token');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Get Notion path from query param e.g. ?p=search or ?p=databases/ID/query
    const notionPath = req.query.p;
    if (!notionPath) {
        return res.status(400).json({ error: 'Missing ?p= query param' });
    }

    // Get token from custom header
    const token = req.headers['x-notion-token'];
    if (!token || (!token.startsWith('secret_') && !token.startsWith('ntn_'))) {
        return res.status(401).json({ error: 'Missing or invalid x-notion-token header' });
    }

    const notionUrl = `https://api.notion.com/v1/${notionPath}`;

    try {
        const notionRes = await fetch(notionUrl, {
            method: req.method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json',
            },
            body: req.method !== 'GET' && req.body ? JSON.stringify(req.body) : undefined,
        });

        const data = await notionRes.json();
        res.status(notionRes.status).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}
