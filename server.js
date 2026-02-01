const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3001;
const JWT_SECRET = 'seismic-kingdoms-secret-2026';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ============================================================
// DATABASE
// ============================================================
const DB_FILE = './kingdoms.json';

function loadDB() {
    try {
        if (fs.existsSync(DB_FILE)) {
            return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        }
    } catch (e) {}
    return {
        users: {},
        kingdoms: {},
        alliances: {},
        battles: [],
        chat: []
    };
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

let db = loadDB();

// ============================================================
// AUTH MIDDLEWARE
// ============================================================
function auth(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (e) {
        res.status(401).json({ error: 'Invalid token' });
    }
}

// ============================================================
// AUTH ROUTES
// ============================================================
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (username.length < 2) return res.status(400).json({ error: 'Username too short' });
    if (db.users[username.toLowerCase()]) return res.status(400).json({ error: 'Name already taken' });

    const user = {
        id: Date.now().toString(),
        username,
        password: await bcrypt.hash(password, 10),
        createdAt: new Date().toISOString()
    };

    const kingdom = {
        id: user.id,
        name: username + "'s Kingdom",
        owner: username,
        level: 1,
        xp: 0,
        resources: { gold: 1000, food: 500, iron: 200 },
        army: { infantry: 30, archers: 15, cavalry: 5 },
        buildings: [
            { type: 'castle', x: 1000, y: 1000, level: 1 },
            { type: 'farm', x: 900, y: 1000, level: 1 },
            { type: 'barracks', x: 1100, y: 1000, level: 1 }
        ],
        banner: '🏴',
        alliance: null,
        position: { x: Math.floor(Math.random() * 1000), y: Math.floor(Math.random() * 1000) }
    };

    db.users[username.toLowerCase()] = user;
    db.kingdoms[user.id] = kingdom;
    saveDB(db);

    const token = jwt.sign({ id: user.id, username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user: { id: user.id, username }, kingdom });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = db.users[username?.toLowerCase()];
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const kingdom = db.kingdoms[user.id];
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user: { id: user.id, username: user.username }, kingdom });
});

// ============================================================
// KINGDOM ROUTES
// ============================================================
app.get('/api/kingdom', auth, (req, res) => {
    const kingdom = db.kingdoms[req.user.id];
    if (!kingdom) return res.status(404).json({ error: 'Kingdom not found' });
    res.json({ kingdom });
});

app.post('/api/kingdom/build', auth, (req, res) => {
    const { type, x, y } = req.body;
    const kingdom = db.kingdoms[req.user.id];
    if (!kingdom) return res.status(404).json({ error: 'Kingdom not found' });

    // Building costs
    const costs = {
        castle: { gold: 0 },
        barracks: { gold: 200, iron: 50 },
        archeryRange: { gold: 300, iron: 100 },
        stable: { gold: 500, iron: 150 },
        farm: { gold: 100 },
        mine: { gold: 150 },
        market: { gold: 200 },
        watchtower: { gold: 100, iron: 30 },
        wall: { gold: 50, iron: 20 },
        temple: { gold: 500 }
    };

    const cost = costs[type];
    if (!cost) return res.status(400).json({ error: 'Invalid building type' });

    // Check resources
    for (const [res, amt] of Object.entries(cost)) {
        if ((kingdom.resources[res] || 0) < amt) {
            return res.status(400).json({ error: 'Insufficient resources' });
        }
    }

    // Deduct resources
    for (const [res, amt] of Object.entries(cost)) {
        kingdom.resources[res] -= amt;
    }

    // Add building
    kingdom.buildings.push({ type, x, y, level: 1 });
    saveDB(db);

    res.json({ success: true, kingdom });
});

app.post('/api/kingdom/train', auth, (req, res) => {
    const { unitType, count } = req.body;
    const kingdom = db.kingdoms[req.user.id];
    if (!kingdom) return res.status(404).json({ error: 'Kingdom not found' });

    const costs = {
        infantry: { gold: 50, food: 20 },
        archers: { gold: 80, food: 25 },
        cavalry: { gold: 150, food: 50, iron: 30 }
    };

    const cost = costs[unitType];
    if (!cost) return res.status(400).json({ error: 'Invalid unit type' });

    const totalCost = {};
    for (const [res, amt] of Object.entries(cost)) {
        totalCost[res] = amt * count;
        if ((kingdom.resources[res] || 0) < totalCost[res]) {
            return res.status(400).json({ error: 'Insufficient resources' });
        }
    }

    for (const [res, amt] of Object.entries(totalCost)) {
        kingdom.resources[res] -= amt;
    }

    kingdom.army[unitType] = (kingdom.army[unitType] || 0) + count;
    saveDB(db);

    res.json({ success: true, kingdom });
});

// ============================================================
// BATTLE ROUTES
// ============================================================
app.post('/api/battle/attack', auth, (req, res) => {
    const { targetId } = req.body;
    const attacker = db.kingdoms[req.user.id];
    const defender = db.kingdoms[targetId];

    if (!attacker || !defender) {
        return res.status(404).json({ error: 'Kingdom not found' });
    }

    // Calculate power
    const attackPower = calculateArmyPower(attacker.army);
    const defensePower = calculateArmyPower(defender.army) * 1.2; // Defender bonus

    const result = {
        attacker: req.user.username,
        defender: defender.owner,
        attackPower,
        defensePower,
        winner: attackPower > defensePower ? 'attacker' : 'defender',
        timestamp: new Date().toISOString()
    };

    // Apply battle results
    if (result.winner === 'attacker') {
        // Attacker wins - steal resources
        const loot = {
            gold: Math.floor(defender.resources.gold * 0.2),
            food: Math.floor(defender.resources.food * 0.2),
            iron: Math.floor(defender.resources.iron * 0.2)
        };

        attacker.resources.gold += loot.gold;
        attacker.resources.food += loot.food;
        attacker.resources.iron += loot.iron;

        defender.resources.gold -= loot.gold;
        defender.resources.food -= loot.food;
        defender.resources.iron -= loot.iron;

        result.loot = loot;

        // Attacker loses some troops
        attacker.army.infantry = Math.floor(attacker.army.infantry * 0.9);
        attacker.army.archers = Math.floor(attacker.army.archers * 0.9);
        attacker.army.cavalry = Math.floor(attacker.army.cavalry * 0.9);
    } else {
        // Defender wins - attacker loses more troops
        attacker.army.infantry = Math.floor(attacker.army.infantry * 0.7);
        attacker.army.archers = Math.floor(attacker.army.archers * 0.7);
        attacker.army.cavalry = Math.floor(attacker.army.cavalry * 0.7);
    }

    db.battles.push(result);
    saveDB(db);

    // Notify via socket
    io.emit('battle', result);

    res.json({ success: true, result, kingdom: attacker });
});

function calculateArmyPower(army) {
    return (army.infantry || 0) * 10 +
           (army.archers || 0) * 15 +
           (army.cavalry || 0) * 25;
}

// ============================================================
// ALLIANCE ROUTES
// ============================================================
app.post('/api/alliance/create', auth, (req, res) => {
    const { name } = req.body;
    if (!name || name.length < 3) return res.status(400).json({ error: 'Name too short' });

    const kingdom = db.kingdoms[req.user.id];
    if (kingdom.alliance) return res.status(400).json({ error: 'Already in an alliance' });

    const alliance = {
        id: Date.now().toString(),
        name,
        leader: req.user.id,
        members: [req.user.id],
        createdAt: new Date().toISOString()
    };

    db.alliances[alliance.id] = alliance;
    kingdom.alliance = alliance.id;
    saveDB(db);

    res.json({ success: true, alliance });
});

app.get('/api/alliances', (req, res) => {
    const alliances = Object.values(db.alliances).map(a => ({
        id: a.id,
        name: a.name,
        members: a.members.length,
        leader: db.users[Object.keys(db.users).find(k => db.users[k].id === a.leader)]?.username
    }));
    res.json({ alliances });
});

// ============================================================
// LEADERBOARD
// ============================================================
app.get('/api/leaderboard', (req, res) => {
    const kingdoms = Object.values(db.kingdoms).map(k => ({
        name: k.name,
        owner: k.owner,
        power: calculateArmyPower(k.army) + k.buildings.length * 50,
        level: k.level
    })).sort((a, b) => b.power - a.power).slice(0, 20);

    res.json({ leaderboard: kingdoms });
});

// ============================================================
// WORLD MAP
// ============================================================
app.get('/api/world', (req, res) => {
    const kingdoms = Object.values(db.kingdoms).map(k => ({
        id: k.id,
        name: k.name,
        owner: k.owner,
        position: k.position,
        banner: k.banner,
        power: calculateArmyPower(k.army)
    }));

    res.json({ kingdoms });
});

// ============================================================
// SOCKET.IO - REAL TIME
// ============================================================
const onlineUsers = new Map();

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    socket.on('join', (data) => {
        onlineUsers.set(socket.id, data);
        io.emit('players_online', onlineUsers.size);
        io.emit('player_joined', { username: data.username });
    });

    socket.on('chat', (data) => {
        const message = {
            sender: data.username,
            text: data.text,
            timestamp: new Date().toISOString()
        };
        db.chat.push(message);
        if (db.chat.length > 100) db.chat = db.chat.slice(-100);
        saveDB(db);
        io.emit('chat', message);
    });

    socket.on('move_army', (data) => {
        // Broadcast army movement to nearby players
        socket.broadcast.emit('army_moved', data);
    });

    socket.on('disconnect', () => {
        const user = onlineUsers.get(socket.id);
        onlineUsers.delete(socket.id);
        io.emit('players_online', onlineUsers.size);
        if (user) {
            io.emit('player_left', { username: user.username });
        }
        console.log('Player disconnected:', socket.id);
    });
});

// ============================================================
// RESOURCE GENERATION (runs every minute)
// ============================================================
setInterval(() => {
    Object.values(db.kingdoms).forEach(kingdom => {
        kingdom.buildings.forEach(b => {
            const production = {
                farm: { food: 10 },
                mine: { iron: 5 },
                market: { gold: 15 }
            };

            if (production[b.type]) {
                Object.entries(production[b.type]).forEach(([res, amt]) => {
                    kingdom.resources[res] = (kingdom.resources[res] || 0) + amt * b.level;
                });
            }
        });
    });
    saveDB(db);
}, 60000);

// ============================================================
// START SERVER
// ============================================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║     👑 SEISMIC KINGDOMS SERVER RUNNING 👑        ║
╠══════════════════════════════════════════════════╣
║     Port: ${PORT}                                    ║
║     Players: ${Object.keys(db.users).length}                                     ║
║     Kingdoms: ${Object.keys(db.kingdoms).length}                                    ║
║     Alliances: ${Object.keys(db.alliances).length}                                   ║
╚══════════════════════════════════════════════════╝
    `);
});
