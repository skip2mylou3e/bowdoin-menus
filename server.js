const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const BOWDOIN_API = 'https://apps.bowdoin.edu/orestes/api.jsp';

// MIME types for static files
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml'
};

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

    // Extract records
    const recordRegex = /<record>([\s\S]*?)<\/record>/g;
    let match;

    while ((match = recordRegex.exec(xml)) !== null) {
        const record = match[1];

        // Extract course name
        const courseMatch = record.match(/<course>([\s\S]*?)<\/course>/);
        const course = courseMatch ? decodeHTMLEntities(courseMatch[1].trim()) : 'Other';

        // Extract item name
        const itemMatch = record.match(/<webLongName>([\s\S]*?)<\/webLongName>/);
        const item = itemMatch ? decodeHTMLEntities(itemMatch[1].trim()) : null;

        if (item) {
            if (!courses[course]) {
                courses[course] = [];
            }
            // Clean up the item name
            const cleanItem = item.replace(/\s+/g, ' ').trim();
            if (cleanItem && !courses[course].includes(cleanItem)) {
                courses[course].push(cleanItem);
            }
        }
    }

    // Sort courses to put main items first
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

        const urlParts = new URL(BOWDOIN_API);

        const options = {
            hostname: urlParts.hostname,
            port: 443,
            path: urlParts.pathname,
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

// Serve static files
function serveStatic(filePath, res) {
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('Not found');
            } else {
                res.writeHead(500);
                res.end('Server error');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
}

// Handle API requests
async function handleAPI(req, res, body) {
    try {
        const data = JSON.parse(body);
        const { unit, date, meal } = data;

        if (!unit || !date || !meal) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing required parameters' }));
            return;
        }

        const menu = await fetchBowdoinMenu(unit, date, meal);

        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=300' // Cache for 5 minutes
        });
        res.end(JSON.stringify(menu));
    } catch (error) {
        console.error('API Error:', error.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to fetch menu', courses: [] }));
    }
}

// Create server
const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // API endpoint
    if (url.pathname === '/api/menu' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => handleAPI(req, res, body));
        return;
    }

    // Static files
    let filePath = url.pathname;
    if (filePath === '/') {
        filePath = '/index.html';
    }

    const fullPath = path.join(__dirname, filePath);
    serveStatic(fullPath, res);
});

server.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🍽️  Bowdoin Dining Menu Server                           ║
║                                                            ║
║   Server running at: http://localhost:${PORT}                ║
║                                                            ║
║   Open this URL in your browser to view the menu.          ║
║   Press Ctrl+C to stop the server.                         ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
    `);
});
