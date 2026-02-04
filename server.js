const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;
const SECRET = 'seismic2026secret';
const DB = './data.json';

app.use(express.json());
app.use(express.static('public'));

function load(){try{return JSON.parse(fs.readFileSync(DB))}catch(e){return {users:{}}}}
function save(d){fs.writeFileSync(DB,JSON.stringify(d,null,2))}
let db = load();

function auth(req,res,next){
    const t=req.headers.authorization?.split(' ')[1];
    if(!t)return res.status(401).json({error:'No token'});
    try{req.user=jwt.verify(t,SECRET);next()}catch(e){res.status(401).json({error:'Bad token'})}
}

app.post('/api/register',async(req,res)=>{
    const {realName,username,password}=req.body;
    if(!realName||realName.length<2)return res.status(400).json({error:'Name too short'});
    if(!username||username.length<3)return res.status(400).json({error:'Username 3+ chars'});
    if(!password||password.length<4)return res.status(400).json({error:'Password 4+ chars'});
    if(db.users[username.toLowerCase()])return res.status(400).json({error:'Username taken'});
    
    const user={id:Date.now()+'',realName,username,password:await bcrypt.hash(password,10),crypto:0,score:0,level:0,weapons:{pistol:true},created:new Date().toISOString()};
    db.users[username.toLowerCase()]=user;
    save(db);
    
    const token=jwt.sign({id:user.id,username,realName},SECRET,{expiresIn:'30d'});
    res.json({success:true,token,user:{id:user.id,username,realName}});
});

app.post('/api/login',async(req,res)=>{
    const {username,password}=req.body;
    const user=db.users[username?.toLowerCase()];
    if(!user||!(await bcrypt.compare(password,user.password)))return res.status(401).json({error:'Invalid login'});
    const token=jwt.sign({id:user.id,username:user.username,realName:user.realName},SECRET,{expiresIn:'30d'});
    res.json({success:true,token,user:{id:user.id,username:user.username,realName:user.realName}});
});

app.get('/api/user/stats',auth,(req,res)=>{
    const u=Object.values(db.users).find(x=>x.id===req.user.id);
    res.json({stats:u?{crypto:u.crypto||0,score:u.score||0,level:u.level||0}:{}});
});

app.get('/api/user/weapons',auth,(req,res)=>{
    const u=Object.values(db.users).find(x=>x.id===req.user.id);
    res.json({weapons:u?.weapons||{pistol:true}});
});

app.post('/api/user/buyweapon',auth,(req,res)=>{
    const {weapon}=req.body;
    const u=Object.values(db.users).find(x=>x.id===req.user.id);
    if(!u)return res.status(404).json({error:'User not found'});
    const costs={rifle:500,shotgun:1000,laser:2000};
    if(!costs[weapon])return res.status(400).json({error:'Invalid weapon'});
    if((u.crypto||0)<costs[weapon])return res.status(400).json({error:'Not enough crypto'});
    u.crypto-=costs[weapon];
    u.weapons=u.weapons||{pistol:true};
    u.weapons[weapon]=true;
    save(db);
    res.json({success:true,weapons:u.weapons});
});

app.post('/api/game/score',auth,(req,res)=>{
    const {level,score,crypto}=req.body;
    const u=Object.values(db.users).find(x=>x.id===req.user.id);
    if(!u)return res.status(404).json({error:'Not found'});
    u.crypto=(u.crypto||0)+crypto;
    if(score>(u.score||0))u.score=score;
    if(level>(u.level||0))u.level=level;
    save(db);
    res.json({success:true});
});

app.get('/api/game/leaderboard',(req,res)=>{
    const list=Object.values(db.users).filter(u=>u.score>0).map(u=>({username:u.username,realName:u.realName,highScore:u.score,level:u.level})).sort((a,b)=>b.highScore-a.highScore).slice(0,20);
    res.json({leaderboard:list});
});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT,()=>console.log('SEISMIC 2026 running on port '+PORT));
