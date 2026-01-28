const https = require('https');

const BOWDOIN_API = 'https://apps.bowdoin.edu/orestes/api.jsp';

// Decode HTML entities
function decodeHTMLEntities(text) {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');
}

// Parse XML menu response
function parseMenuXML(xml) {
    const courses = {};

    const recordRegex = /<record>([\s\S]*?)<\/record>/g;
    let match;

    while ((match = recordRegex.exec(xml)) !== null) {
        const record = match[1];

        const courseMatch = record.match(/<course>([\s\S]*?)<\/course>/);
        const course = courseMatch ? decodeHTMLEntities(courseMatch[1].trim()) : 'Other';

        const itemMatch = record.match(/<webLongName>([\s\S]*?)<\/webLongName>/);
        const item = itemMatch ? decodeHTMLEntities(itemMatch[1].trim()) : null;

        if (item) {
            if (!courses[course]) {
                courses[course] = [];
            }
            const cleanItem = item.replace(/\s+/g, ' ').trim();
            if (cleanItem && !courses[course].includes(cleanItem)) {
                courses[course].push(cleanItem);
            }
        }
    }

    const courseOrder = ['Main Course', 'Entree', 'Main', 'Grill', 'Pizza', 'Pasta', 'Soup', 'Salad', 'Side', 'Vegetable', 'Starch', 'Bread', 'Dessert', 'Beverage'];

    const sortedCourses = Object.entries(courses)
        .sort((a, b) => {
            const aIndex = courseOrder.findIndex(c => a[0].toLowerCase().includes(c.toLowerCase()));
            const bIndex = courseOrder.findIndex(c => b[0].toLowerCase().includes(c.toLowerCase()));

            if (aIndex === -1 && bIndex === -1) return a[0].localeCompare(b[0]);
            if (aIndex === -1) return 1;
            if (bIndex === -1) return -1;
            return aIndex - bIndex;
        })
        .map(([name, items]) => ({ name, items }));

    return { courses: sortedCourses };
}

// Fetch menu from Bowdoin API
function fetchBowdoinMenu(unit, date, meal) {
    return new Promise((resolve, reject) => {
        const postData = `unit=${unit}&date=${date}&meal=${meal}`;

        const options = {
            hostname: 'apps.bowdoin.edu',
            port: 443,
            path: '/orestes/api.jsp',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData),
                'User-Agent': 'BowdoinMenuApp/1.0'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const menu = parseMenuXML(data);
                        resolve(menu);
                    } catch (e) {
                        reject(new Error('Failed to parse menu data'));
                    }
                } else {
                    reject(new Error(`API returned status ${res.statusCode}`));
                }
            });
        });

        req.on('error', (e) => {
            reject(e);
        });

        req.write(postData);
        req.end();
    });
}

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { unit, date, meal } = req.body;

        if (!unit || !date || !meal) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        const menu = await fetchBowdoinMenu(unit, date, meal);

        res.setHeader('Cache-Control', 'public, max-age=300');
        return res.status(200).json(menu);
    } catch (error) {
        console.error('API Error:', error.message);
        return res.status(500).json({ error: 'Failed to fetch menu', courses: [] });
    }
};
