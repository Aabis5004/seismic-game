const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'seismic-game-secret-2026';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database
const DB_FILE = './database.json';
function loadDB() {
    try { if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE,'utf8')); } catch(e){}
    return {users:{},leaderboard:[]};
}
function saveDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data,null,2)); }
let db = loadDB();

// Auth Middleware
function auth(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({error:'No token'});
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch(e) { res.status(401).json({error:'Invalid token'}); }
}

// Register
app.post('/api/register', async (req, res) => {
    const {username, password} = req.body;
    if (!username || !password) return res.status(400).json({error:'Username and password required'});
    if (username.length < 3) return res.status(400).json({error:'Username too short'});
    if (password.length < 4) return res.status(400).json({error:'Password too short'});
    if (db.users[username.toLowerCase()]) return res.status(400).json({error:'Username taken'});
    
    const user = {
        id: Date.now().toString(),
        username,
        password: await bcrypt.hash(password, 10),
        progress: {maxUnlockedLevel:1, totalScore:0, levelScores:{}, levelStars:{}}
    };
    db.users[username.toLowerCase()] = user;
    saveDB(db);
    
    const token = jwt.sign({id:user.id, username}, JWT_SECRET, {expiresIn:'30d'});
    res.json({success:true, token, user:{id:user.id, username, progress:user.progress}});
});

// Login
app.post('/api/login', async (req, res) => {
    const {username, password} = req.body;
    const user = db.users[username?.toLowerCase()];
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({error:'Invalid username or password'});
    }
    const token = jwt.sign({id:user.id, username:user.username}, JWT_SECRET, {expiresIn:'30d'});
    res.json({success:true, token, user:{id:user.id, username:user.username, progress:user.progress}});
});

// Save Progress
app.post('/api/progress/level', auth, (req, res) => {
    const {levelId, score, stars} = req.body;
    const user = Object.values(db.users).find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({error:'User not found'});
    
    if (!user.progress.levelScores[levelId] || score > user.progress.levelScores[levelId]) {
        user.progress.levelScores[levelId] = score;
    }
    if (!user.progress.levelStars[levelId] || stars > user.progress.levelStars[levelId]) {
        user.progress.levelStars[levelId] = stars;
    }
    if (levelId >= user.progress.maxUnlockedLevel) {
        user.progress.maxUnlockedLevel = levelId + 1;
    }
    user.progress.totalScore = Object.values(user.progress.levelScores).reduce((a,b)=>a+b,0);
    
    // Update leaderboard
    db.leaderboard = db.leaderboard.filter(e => e.odtuserId !== user.id);
    db.leaderboard.push({userId:user.id, username:user.username, totalScore:user.progress.totalScore});
    db.leaderboard.sort((a,b) => b.totalScore - a.totalScore);
    db.leaderboard = db.leaderboard.slice(0, 50);
    
    saveDB(db);
    res.json({success:true, progress:user.progress});
});

// Leaderboard
app.get('/api/leaderboard', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit)||10, 50);
    res.json({leaderboard: db.leaderboard.slice(0, limit)});
});

// Serve game
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║   🎮 SEISMIC GAME SERVER               ║
║   Port: ${PORT}                            ║
║   Users: ${Object.keys(db.users).length}                              ║
╚════════════════════════════════════════╝
    `);
});
