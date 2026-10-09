/** Original, procedural pixel artwork for Dead Signal. No external assets. */
const TAU = Math.PI * 2;
const clamp = (n,a,b) => Math.max(a, Math.min(b,n));
function seeded(seed) { let s = seed >>> 0; return () => { s = Math.imul(1664525,s) + 1013904223 | 0; return (s>>>0)/4294967296; }; }
function rgba(hex,a) { return hex.startsWith('#') && hex.length===7 ? `rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${a})` : hex; }
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d',{alpha:false});
    this.camera = { x:380, y:830, zoom:0.78 };
    this.width = 1; this.height = 1; this.cache = null; this.cacheKey = ''; this.lastTime = 0; this.initialized = false;
    canvas.style.imageRendering = 'pixelated';
    this.resize();
  }
  resize() {
    const b=this.canvas.getBoundingClientRect();
    this.cssWidth=b.width || this.canvas.parentElement?.clientWidth || 800;
    this.cssHeight=b.height || this.canvas.parentElement?.clientHeight || 600;
    // A real, low-resolution art buffer keeps every sprite crisp on retina screens.
    this.width=Math.max(1,Math.ceil(this.cssWidth / 2));
    this.height=Math.max(1,Math.ceil(this.cssHeight / 2));
    if(this.canvas.width!==this.width || this.canvas.height!==this.height) {
      this.canvas.width=this.width; this.canvas.height=this.height;
    }
    this.ctx.imageSmoothingEnabled=false;
  }
  screenToWorld(clientX,clientY) {
    const b=this.canvas.getBoundingClientRect();
    return { x:this.camera.x+((clientX-b.left)/b.width*this.width-this.width/2)/this.camera.zoom,
      y:this.camera.y+((clientY-b.top)/b.height*this.height-this.height/2)/this.camera.zoom };
  }
  worldToScreen(x,y) {
    const b=this.canvas.getBoundingClientRect();
    return { x:b.left+((x-this.camera.x)*this.camera.zoom+this.width/2)/this.width*b.width,
      y:b.top+((y-this.camera.y)*this.camera.zoom+this.height/2)/this.height*b.height };
  }
  makeTerrain(state) {
    const world=state.world; const w=world.width,h=world.height;
    const terrain=document.createElement('canvas'); terrain.width=w; terrain.height=h;
    const c=terrain.getContext('2d'); const r=seeded(1977+(Number(state.mission)+1||1)*137);
    c.imageSmoothingEnabled=false;
    c.fillStyle='#526044'; c.fillRect(0,0,w,h);
    // Warm patches and lush grass grow across an original hand-shaped coastal map.
    for(let i=0;i<220;i++) {
      const x=r()*w,y=r()*h;
      c.fillStyle=['#566348','#4b5b40','#5c6646','#4c6045','#626b47'][i%5];
      c.beginPath();c.ellipse(x,y,35+r()*85,15+r()*55,r()*TAU,0,TAU);c.fill();
    }
    const coast=(fill,offset)=>{
      c.fillStyle=fill; c.beginPath(); c.moveTo(-10,-10); c.lineTo(w+10,-10); c.lineTo(w+10,h+10);
      c.lineTo(w-43+offset,h+10);c.lineTo(w-49+offset,h-110);c.lineTo(w-85+offset,h-255);c.lineTo(w-60+offset,h-420);
      c.lineTo(w-116+offset,h-555);c.lineTo(w-70+offset,h-705);c.lineTo(w-108+offset,210);
      c.lineTo(w-260,58-offset);c.lineTo(w-440,88-offset);c.lineTo(w-645,52-offset);c.lineTo(w-890,74-offset);
      c.lineTo(180,45-offset);c.lineTo(-10,100-offset);c.closePath();c.fill();
    };
    coast('#bcad72',-18);coast('#83a18a',-2);coast('#477e7c',13);coast('#306569',27);coast('#29585f',52);
    // Alternating bands of tiny broken surf are drawn by hand, not an image filter.
    for(let i=0;i<190;i++) {
      const x=r()*w,y=r()*46;
      c.fillStyle=i%2?'#518e88':'#609b8e';c.fillRect(x,y,6+r()*19,2);
      if(i%3===0)c.fillRect(w-30-r()*17,r()*h,2,9+r()*15);
    }
    function path(points,width,color) {
      c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.lineJoin='round';c.beginPath();
      points.forEach((p,i)=>i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]));c.stroke();
    }
    const main=[[130,h-35],[218,970],[420,880],[510,698],[715,633],[810,470],[1030,389],[1200,260],[1380,220],[w-90,130]];
    const branch=[[422,880],[625,952],[850,850],[1120,830],[1230,620],[1190,420]];
    path(main,82,'#49543b');path(main,67,'#9d9364');path(main,53,'#b5a371');path(main,36,'#bcad7d');
    path(branch,65,'#48563d');path(branch,49,'#9d9364');path(branch,37,'#afa070');
    path([[515,697],[327,540],[240,320],[450,215],[680,240]],47,'#8d885c');
    path([[515,697],[327,540],[240,320],[450,215],[680,240]],34,'#a39768');
    // Pixel-sized botanical texture; spacious bare ground keeps gameplay legible.
    for(let i=0;i<14000;i++) {
      const x=Math.floor(r()*w),y=Math.floor(95+r()*(h-95));
      if(x>w-125)continue;
      c.fillStyle=['#3c5036','#6c7650','#74815a','#46593c','#7e8055','#566743'][i%6];
      c.fillRect(x,y,1+Math.floor(r()*3),1+Math.floor(r()*3));
      if(i%7===0) {c.fillRect(x+2,y-3,1,4);c.fillRect(x-2,y-1,1,3);}
    }
    // Tire ruts and irregular pebbles on the winding mission trail.
    for(let i=0;i<main.length-1;i++) {
      const a=main[i],b=main[i+1],d=Math.hypot(b[0]-a[0],b[1]-a[1]),dx=(b[0]-a[0])/d,dy=(b[1]-a[1])/d;
      for(let t=10;t<d;t+=11) {
        c.fillStyle='#8f855b';
        c.fillRect(a[0]+dx*t-dy*15,a[1]+dy*t+dx*15,3,2);
        c.fillRect(a[0]+dx*t+dy*15,a[1]+dy*t-dx*15,3,2);
      }
    }
    // Low plants, wildflowers, fallen branches, craters and disused camp equipment.
    for(let i=0;i<180;i++) {
      let x=70+r()*(w-220),y=140+r()*(h-210);
      c.fillStyle='#374b33';c.fillRect(x,y,6,2);c.fillRect(x+2,y-3,2,5);
      c.fillStyle='#77825a';c.fillRect(x+2,y-3,2,1);
      if(i%8===0){c.fillStyle='#c5b67d';c.fillRect(x+7,y-2,2,2);}
    }
    for(let i=0;i<12;i++) {
      const x=140+r()*(w-300),y=190+r()*(h-350);
      c.fillStyle='#3f4934';c.beginPath();c.ellipse(x,y,13,9,0,0,TAU);c.fill();
      c.fillStyle='#6f6948';c.beginPath();c.ellipse(x,y-1,8,5,0,0,TAU);c.fill();
      c.fillStyle='#55533c';c.fillRect(x-3,y-2,6,4);
    }
    for(const d of world.decorations||[])this.drawDecoration(c,d,state);
    // Original abandoned camp props add story without affecting navigation.
    for(const d of [
      {x:583,y:868,type:'wreck'}, {x:502,y:834,type:'crate'}, {x:522,y:840,type:'crate'},
      {x:573,y:853,type:'sandbags'}, {x:667,y:771,type:'bones'}, {x:688,y:499,type:'crate'},
      {x:720,y:541,type:'fence'}, {x:1210,y:451,type:'fence'}, {x:1111,y:803,type:'sandbags'},
      {x:1339,y:276,type:'crate'}, {x:1358,y:282,type:'crate'}, {x:989,y:892,type:'bones'}
    ])this.drawDecoration(c,d,state);
    this.cache=terrain;
  }
  drawDecoration(c,d,state) {
    const x=Math.round(d.x),y=Math.round(d.y);
    c.save(); c.translate(x,y);
    switch(d.type) {
      case 'sandbag': case 'sandbags':
        c.fillStyle='#36412c';c.fillRect(-22,-4,46,11);
        for(let i=-20;i<24;i+=11){c.fillStyle='#a79d70';c.fillRect(i,-8,10,7);c.fillStyle='#cdc18a';c.fillRect(i+1,-8,8,2);c.fillStyle='#817653';c.fillRect(i+1,-2,8,1);}break;
      case 'fence':
        c.fillStyle='#28372b';c.fillRect(-26,-5,54,2);c.fillRect(-26,0,54,2);
        for(let i=-25;i<=25;i+=25){c.fillStyle='#726c50';c.fillRect(i,-13,3,19);c.fillStyle='#ada071';c.fillRect(i,-13,1,17);}break;
      case 'crate': case 'supplies':
        c.fillStyle='#293929';c.fillRect(-11,-4,24,13);c.fillStyle='#7a7049';c.fillRect(-11,-11,22,16);c.fillStyle='#a69860';c.fillRect(-9,-9,18,2);c.fillRect(-9,1,18,2);c.fillStyle='#484e33';c.fillRect(-1,-9,2,12);break;
      case 'dirt':
        c.fillStyle='#7c7a50';c.fillRect(-5,-2,9,3);c.fillStyle='#8d895c';c.fillRect(-3,-3,5,2);break;
      case 'crater':
        c.fillStyle='#404a34';c.beginPath();c.ellipse(0,0,16,10,0,0,TAU);c.fill();c.fillStyle='#716e4b';c.beginPath();c.ellipse(0,-1,11,7,0,0,TAU);c.fill();c.fillStyle='#52553b';c.fillRect(-5,-4,10,5);break;
      case 'flower':
        c.fillStyle='#9eb078';c.fillRect(-1,-4,2,6);c.fillStyle='#d5c194';c.fillRect(-3,-6,6,3);break;
      case 'wreck': case 'jeep':
        c.fillStyle='#29362b';c.fillRect(-19,-7,39,21);c.fillStyle='#3c4533';c.fillRect(-18,-13,36,21);c.fillStyle='#827a55';c.fillRect(-16,-12,31,3);c.fillStyle='#263f3d';c.fillRect(-8,-8,15,7);c.fillStyle='#1f2822';c.fillRect(-22,-10,5,8);c.fillRect(17,-10,5,8);c.fillRect(-22,2,5,8);c.fillRect(17,2,5,8);c.fillStyle='#697651';c.fillRect(-11,3,21,4);c.fillStyle='#b7a170';c.fillRect(-13,-14,4,2);break;
      case 'bones': case 'skull':
        c.fillStyle='#cdc3a3';c.fillRect(-4,-5,7,5);c.fillRect(-2,0,4,2);c.fillStyle='#464b36';c.fillRect(-3,-3,2,2);c.fillRect(1,-3,2,2);c.fillStyle='#bcb294';c.fillRect(6,1,8,2);break;
      default:
        // Keep unknown engine decorations natural and readable.
        c.fillStyle='#384f34';c.fillRect(-5,-3,11,5);c.fillStyle='#6c8051';c.fillRect(-3,-5,4,3);c.fillRect(2,-2,6,2);
    }
    c.restore();
  }
  render(state,{preview=false}={}) {
    if(!state?.world)return;
    const now=performance.now(),dt=Math.min(.06,(now-this.lastTime)/1000 || .016);this.lastTime=now;
    const w=state.world.width,h=state.world.height;
    const mission=typeof state.mission==='object'?state.mission.id:state.mission;
    const key=`${mission}:${w}:${h}:${(state.world.decorations||[]).length}`;
    if(key!==this.cacheKey){this.cacheKey=key;this.makeTerrain(state);this.initialized=false;}
    const leader=(state.soldiers||[]).find(s=>s.id===state.leaderId && s.alive)||(state.soldiers||[]).find(s=>s.alive);
    const portrait=this.height>this.width;
    const zoom=preview?(portrait?.45:.56):(portrait?.73:.86);
    let tx=leader?.x??w/2,ty=leader?.y??h/2;
    if(preview){tx+=portrait?60:150;ty-=portrait?115:25;}
    if(!this.initialized){this.camera.x=tx;this.camera.y=ty;this.camera.zoom=zoom;this.initialized=true;}
    const follow=1-Math.exp(-dt*5);
    this.camera.zoom+=(zoom-this.camera.zoom)*follow;
    if(state.status!=='paused'){this.camera.x+=(tx-this.camera.x)*follow;this.camera.y+=(ty-this.camera.y)*follow;}
    const halfW=this.width/2/this.camera.zoom,halfH=this.height/2/this.camera.zoom;
    this.camera.x=clamp(this.camera.x,Math.min(halfW,w/2),Math.max(w-halfW,w/2));
    this.camera.y=clamp(this.camera.y,Math.min(halfH,h/2),Math.max(h-halfH,h/2));
    const c=this.ctx;c.setTransform(1,0,0,1,0,0);c.imageSmoothingEnabled=false;c.fillStyle='#29585f';c.fillRect(0,0,this.width,this.height);
    c.save();c.translate(Math.round(this.width/2),Math.round(this.height/2));c.scale(this.camera.zoom,this.camera.zoom);c.translate(-Math.round(this.camera.x),-Math.round(this.camera.y));
    c.drawImage(this.cache,0,0);
    if(leader && (state.noise||0)>30 && !preview){
      const wave=((state.time||0)*.65)%1;
      c.strokeStyle=`rgba(231,203,139,${(1-wave)*.16})`;c.lineWidth=1;
      c.beginPath();c.arc(leader.x,leader.y,25+wave*(state.noise||0)*1.5,0,TAU);c.stroke();
    }
    // Objective markers live in the landscape and never compete with combat text.
    const ex=state.extraction;
    if(ex){
      c.save();c.translate(ex.x,ex.y);const pulse=Math.sin((state.time||0)*3)*2;
      c.strokeStyle=ex.active?'#bfdc91':'#c7bb7b';c.lineWidth=2;c.setLineDash([7,7]);c.strokeRect(-ex.r,-ex.r,ex.r*2,ex.r*2);c.setLineDash([]);
      c.strokeStyle=ex.active?'#d6eeaf':'#9d976b';c.beginPath();c.arc(0,0,ex.r-5+pulse,0,TAU);c.stroke();
      c.globalAlpha=.16;c.fillStyle=ex.active?'#c5e78c':'#e4d796';c.fillRect(-ex.r,-ex.r,ex.r*2,ex.r*2);c.globalAlpha=1;
      c.fillStyle='#d9d8a4';c.fillRect(-11,-2,22,4);c.fillRect(-2,-11,4,22);
      if(ex.progress>0){c.lineWidth=4;c.strokeStyle='#e5f7a4';c.beginPath();c.arc(0,0,ex.r-2,-Math.PI/2,-Math.PI/2+TAU*clamp(ex.progress>1?ex.progress/3:ex.progress,0,1));c.stroke();}
      c.restore();
    }
    for(const person of state.civilians||[]){if(!person.rescued){c.strokeStyle='#b2d9c3';c.lineWidth=1;c.setLineDash([3,4]);c.beginPath();c.arc(person.x,person.y,22,0,TAU);c.stroke();c.setLineDash([]);}}
    if(state.target && leader && !preview){
      c.strokeStyle='rgba(214,230,171,.5)';c.lineWidth=1;c.setLineDash([3,6]);c.beginPath();c.moveTo(leader.x,leader.y);c.lineTo(state.target.x,state.target.y);c.stroke();c.setLineDash([]);
      c.strokeStyle='#d5ebac';c.lineWidth=2;c.beginPath();c.arc(state.target.x,state.target.y,8,0,TAU);c.stroke();
      c.fillStyle='#ebf5c9';c.fillRect(state.target.x-2,state.target.y-2,4,4);
    }
    for(const dead of state.corpses||[])this.drawCorpse(c,dead);
    const objects=[];
    for(const o of state.world.obstacles||[])if(o.alive!==false)objects.push({y:o.y+(o.h||0),type:'obstacle',data:o});
    for(const s of state.soldiers||[])if(s.alive)objects.push({y:s.y,type:'squad',data:s});
    for(const e of state.enemies||[])if(e.alive)objects.push({y:e.y,type:e.type==='zombie'?'zombie':'enemy',data:e});
    for(const p of state.civilians||[])if(p.alive!==false)objects.push({y:p.y,type:'civilian',data:p});
    objects.sort((a,b)=>a.y-b.y);
    for(const o of objects){if(o.type==='obstacle')this.drawObstacle(c,o.data,state);else this.drawPerson(c,o.data,o.type,state,o.data.id===state.leaderId);}
    for(const b of state.bullets||[]){
      c.strokeStyle=b.team==='enemy'?'#f4b786':'#f8e6a6';c.lineWidth=2;c.beginPath();c.moveTo(b.x,b.y);const d=Math.hypot(b.vx||0,b.vy||0)||1;c.lineTo(b.x-(b.vx||0)/d*8,b.y-(b.vy||0)/d*8);c.stroke();
      c.fillStyle='#fff7d5';c.fillRect(b.x-1,b.y-1,2,2);
    }
    for(const g of state.thrownGrenades||[]){
      c.fillStyle='rgba(25,38,25,.3)';c.beginPath();c.ellipse(g.x,g.y,5,3,0,0,TAU);c.fill();
      c.fillStyle='#d7d2a0';c.fillRect(g.x-2,g.y-(g.height||0)-4,5,5);c.fillStyle='#5a6c45';c.fillRect(g.x-1,g.y-(g.height||0)-3,3,3);
    }
    for(const p of state.particles||[])this.drawParticle(c,p);
    c.restore();
    this.drawVignette(c);
    if(!preview)this.drawMinimap(c,state);
    if(!preview && state.status==='playing')this.drawObjectiveDirection(c,state,leader);
  }
  drawObstacle(c,o,state) {
    const w=o.w||28,h=o.h||28,x=Math.round(o.x+w/2),y=Math.round(o.y+h/2);
    c.save();c.translate(x,y);
    if(o.type==='tree'){
      // Layered fan palms have chunky, unmistakable pixel silhouettes.
      c.fillStyle='rgba(26,38,28,.25)';c.beginPath();c.ellipse(10,6,w*.65,h*.35,0,0,TAU);c.fill();
      c.fillStyle='#574e33';c.fillRect(-3,-h*.44,7,h*.58);c.fillStyle='#a08751';c.fillRect(-1,-h*.43,2,h*.53);
      const cy=-h*.4, reach=Math.max(w*.64,22);
      const leaves=[[-1,-1],[1,-.9],[-1,.3],[1,.5],[0,-1.4],[-.4,1]];
      for(const [dx,dy]of leaves){
        c.fillStyle='#294732';c.beginPath();c.moveTo(0,cy);c.lineTo(dx*reach,cy+dy*reach*.75);c.lineTo(dx*reach*.6+(dy>0?8:-6),cy+dy*reach*.85+9);c.lineTo(dx*reach*.22,cy+5);c.closePath();c.fill();
        c.strokeStyle='#4d7144';c.lineWidth=3;c.beginPath();c.moveTo(0,cy);c.lineTo(dx*reach*.84,cy+dy*reach*.62);c.stroke();
        c.strokeStyle='#6c8850';c.lineWidth=1;c.beginPath();c.moveTo(0,cy-1);c.lineTo(dx*reach*.68,cy+dy*reach*.52);c.stroke();
      }
      c.fillStyle='#1f3b2c';c.fillRect(-6,cy-2,12,8);c.fillStyle='#69804c';c.fillRect(-4,cy-4,6,5);
    } else if(o.type==='hut'){
      c.fillStyle='rgba(24,33,26,.33)';c.fillRect(-w/2+9,-h/2+13,w+2,h+4);
      c.fillStyle='#615e43';c.fillRect(-w/2,-h/2,w,h);c.fillStyle='#3b4736';c.fillRect(-w/2,-h/2+11,w,h-11);
      c.fillStyle='#72755a';c.fillRect(-w/2,-h/2,w,h-16);
      for(let i=-w/2+4;i<w/2;i+=7){c.fillStyle=i%2?'#5d674e':'#848466';c.fillRect(i,-h/2+2,2,h-19);}
      c.fillStyle='#9a9975';c.fillRect(-w/2,-h/2,w,3);c.fillStyle='#444d37';c.fillRect(-w/2,h/2-20,w,3);
      c.fillStyle='#263d36';c.fillRect(-w/2+7,h/2-16,12,9);c.fillRect(w/2-19,h/2-16,12,9);
      c.fillStyle='#1e3029';c.fillRect(-7,h/2-13,14,13);c.fillStyle='#b3a879';c.fillRect(5,h/2-9,2,2);
      c.fillStyle='#3a4232';c.fillRect(-w/2-3,-h/2-3,3,h+6);c.fillRect(w/2,-h/2-3,3,h+6);
      c.fillStyle='#bab18a';c.fillRect(-5,-h/2+9,10,2);c.fillRect(-1,-h/2+5,2,10);
    } else if(o.type==='barrel'){
      c.fillStyle='rgba(20,35,24,.25)';c.fillRect(-7,-3,19,16);
      c.fillStyle='#384c38';c.fillRect(-7,-10,14,19);c.fillStyle='#729054';c.fillRect(-6,-9,12,16);c.fillStyle='#9aa16a';c.fillRect(-4,-10,8,2);
      c.fillStyle='#344b36';c.fillRect(-7,-5,14,2);c.fillRect(-7,4,14,2);c.fillStyle='#d4c57b';c.fillRect(-3,-2,6,4);c.fillStyle='#58663d';c.fillRect(-1,-2,2,3);
    } else {
      c.fillStyle='rgba(25,35,27,.3)';c.beginPath();c.ellipse(5,7,w*.57,h*.43,0,0,TAU);c.fill();
      c.fillStyle='#6b705c';c.beginPath();c.moveTo(-w*.5,h*.2);c.lineTo(-w*.32,-h*.38);c.lineTo(w*.12,-h*.48);c.lineTo(w*.47,-h*.18);c.lineTo(w*.5,h*.35);c.lineTo(0,h*.5);c.closePath();c.fill();
      c.fillStyle='#91917a';c.beginPath();c.moveTo(-w*.3,-h*.35);c.lineTo(w*.1,-h*.45);c.lineTo(w*.35,-h*.15);c.lineTo(-w*.15,-h*.02);c.closePath();c.fill();
      c.fillStyle='#515d49';c.fillRect(-w*.2,h*.16,w*.28,2);c.fillRect(w*.23,h*.03,3,h*.2);
    }
    c.restore();
  }
  drawPerson(c,p,type,state,leader) {
    const x=Math.round(p.x),y=Math.round(p.y),angle=Number.isFinite(p.angle)?p.angle:-Math.PI/2;
    const zombie=type==='zombie',civilian=type==='civilian',enemy=type==='enemy';
    const time=state.time||0;const step=Math.sin(time*9+(Number(p.id)||0)*2)>0?1:-1;
    c.save();c.translate(x,y);
    c.fillStyle='rgba(23,37,27,.35)';c.beginPath();c.ellipse(2,4,zombie?8:7,4,0,0,TAU);c.fill();
    if(leader){c.strokeStyle='#d5e8a3';c.lineWidth=1;c.beginPath();c.ellipse(0,3,11,6,0,0,TAU);c.stroke();c.fillStyle='#edf4b8';c.fillRect(-2,-22,4,2);c.fillRect(-1,-20,2,2);}
    // Feet and small stepped outline draw a readable silhouette at phone scale.
    c.fillStyle=zombie?'#343d32':civilian?'#354c51':'#263c31';
    c.fillRect(-5,3,4,5+step);c.fillRect(2,3,4,5-step);
    const coat=zombie?'#6e8655':civilian?'#c0ab78':enemy?'#826a4d':'#688357';
    c.fillStyle='#283b2c';c.fillRect(-7,-10,14,14);c.fillStyle=coat;c.fillRect(-5,-9,10,12);
    c.fillStyle=zombie?'#96aa70':civilian?'#dfc399':enemy?'#b29a6d':'#94a271';c.fillRect(-4,-9,3,2);c.fillRect(-4,-5,1,5);
    c.fillStyle=zombie?'#42523c':civilian?'#9d8d64':'#475b3b';c.fillRect(-4,0,8,3);
    if(!zombie&&!civilian){c.fillStyle='#324736';c.fillRect(-3,-7,6,6);c.fillStyle=enemy?'#bb9a64':'#97ad74';c.fillRect(-2,-5,2,2);}
    const dx=Math.cos(angle),dy=Math.sin(angle);
    if(zombie){
      c.fillStyle='#aab985';c.fillRect(Math.round(dx*6)-2,Math.round(dy*6)-6,4,6);c.fillRect(Math.round(dx*4)-6,Math.round(dy*4)-4,3,5);
      c.fillStyle='#a8b883';c.fillRect(-5,-17,10,9);c.fillRect(-3,-9,6,3);c.fillStyle='#c0c997';c.fillRect(-4,-16,7,2);
      c.fillStyle='#283d2c';c.fillRect(-4,-13,3,3);c.fillRect(2,-13,2,3);c.fillRect(-2,-8,4,1);c.fillStyle='#d0cf9b';c.fillRect(-1,-10,2,2);
      c.fillStyle='#8b5540';c.fillRect(3,-5,2,4);
    } else {
      c.fillStyle='#e0c292';c.fillRect(-4,-14,8,6);c.fillStyle= civilian?'#493e31':enemy?'#5c6246':'#405c3d';c.fillRect(-5,-18,10,6);c.fillRect(-6,-14,12,2);
      c.fillStyle=civilian?'#695339':enemy?'#91815c':'#819367';c.fillRect(-4,-18,7,2);
      c.fillStyle='#3c4934';c.fillRect(dx>0?2:-3,-11,2,2);
      if(civilian){
        c.fillStyle='#e4cf9c';c.fillRect(-8,-8,3,6);c.fillRect(5,-8,3,6);
        if(!p.rescued&&Math.sin(time*2)>-.6){c.fillStyle='#c9e6cf';c.fillRect(-1,-29,2,6);c.fillRect(-1,-21,2,2);}
      } else {
        c.save();c.translate(0,-4);c.rotate(angle);
        c.fillStyle='#d4bd8d';c.fillRect(3,-2,5,4);c.fillStyle='#263c34';c.fillRect(4,-2,13,3);c.fillStyle='#768169';c.fillRect(13,-2,5,1);c.fillStyle='#1e322d';c.fillRect(9,0,3,4);
        if(p.shootFlash>0){c.fillStyle='#fff0ae';c.fillRect(19,-3,5,5);c.fillRect(21,-5,2,9);c.fillStyle='#e8b65f';c.fillRect(23,-2,4,3);}
        c.restore();
      }
    }
    if(p.hp!==undefined && p.maxHp && (p.hp<p.maxHp||type==='squad')){
      c.fillStyle='#273a2d';c.fillRect(-7,12,14,3);c.fillStyle=type==='squad'?'#acd685':zombie?'#b58a62':'#dcad77';c.fillRect(-6,13,Math.max(0,12*p.hp/p.maxHp),1);
    }
    c.restore();
  }
  drawCorpse(c,p) {
    c.save();c.translate(Math.round(p.x),Math.round(p.y));
    c.fillStyle='#6d5640';c.fillRect(-9,-1,18,5);c.fillStyle=p.type==='zombie'?'#617044':'#4d6345';c.fillRect(-6,-3,12,7);c.fillStyle=p.type==='zombie'?'#a3ae7a':'#beab7d';c.fillRect(5,-4,5,5);c.fillStyle='#304332';c.fillRect(-11,0,5,3);c.fillRect(-9,5,5,2);c.restore();
  }
  drawParticle(c,p) {
    const alpha=clamp((p.life||0)/(p.maxLife||1),0,1);c.save();c.globalAlpha=alpha;
    const type=p.type||'spark';
    if(type==='ring'){
      c.lineWidth=2;c.strokeStyle=p.color||'#e1dcb4';c.beginPath();c.arc(p.x,p.y,(p.radius||25)*(1-alpha*.7),0,TAU);c.stroke();
    }else if(type==='smoke'||type==='dust'){
      const size=4+(1-alpha)*10;c.globalAlpha=alpha*.5;c.fillStyle=p.color||'#b8b59a';c.fillRect(Math.round(p.x-size/2),Math.round(p.y-size/2),size,size);
    }else if(type==='explosion'||type==='fire'){
      const size=3+alpha*6;c.fillStyle=p.color||'#ecc573';c.fillRect(Math.round(p.x-size/2),Math.round(p.y-size/2),size,size);
    }else{c.fillStyle=p.color||(type==='blood'?'#8f664b':'#e2d5a1');c.fillRect(Math.round(p.x),Math.round(p.y),type==='blood'?3:2,type==='blood'?2:2);}
    c.restore();
  }
  drawVignette(c) {
    // A very light edge treatment ties the field to the dark tactical interface.
    const g=c.createRadialGradient(this.width/2,this.height/2,Math.min(this.width,this.height)*.35,this.width/2,this.height/2,Math.max(this.width,this.height)*.73);
    g.addColorStop(0,'rgba(13,28,23,0)');g.addColorStop(1,'rgba(13,28,23,.2)');c.fillStyle=g;c.fillRect(0,0,this.width,this.height);
  }
  drawObjectiveDirection(c,state,leader) {
    if(!leader)return;
    const nearest=(items)=>items.reduce((best,p)=>!best || Math.hypot(p.x-leader.x,p.y-leader.y)<Math.hypot(best.x-leader.x,best.y-leader.y)?p:best,null);
    let target=nearest((state.civilians||[]).filter(p=>!p.rescued && p.alive!==false));
    let label='RESCUE',color='#c2e4cc';
    if(!target && state.extraction?.active){target=state.extraction;label='EXTRACT';color='#e7e4a2';}
    if(!target && Number(state.mission)===2){target=nearest((state.enemies||[]).filter(e=>e.alive));label='HOSTILES';color='#e5b694';}
    if(!target)return;
    const dx=target.x-leader.x,dy=target.y-leader.y,angle=Math.atan2(dy,dx);
    const distance=Math.round(Math.hypot(dx,dy)/10)*10;
    const caption=`${label}  ${distance}m`;
    c.save();c.font='bold 10px monospace';c.textBaseline='middle';
    const chipWidth=c.measureText(caption).width+27;
    const compact=this.height<170;
    const radarWidth=Math.min(68,Math.round(this.width*.25));
    const chipX=Math.round(compact?Math.min((this.width-chipWidth)/2,this.width-radarWidth-chipWidth-13):(this.width-chipWidth)/2),chipY=compact?24:53;
    c.fillStyle='rgba(17,37,32,.88)';c.fillRect(chipX,chipY,chipWidth,18);
    c.strokeStyle='rgba(186,206,150,.32)';c.lineWidth=1;c.strokeRect(chipX+.5,chipY+.5,chipWidth-1,17);
    this.drawBearingArrow(c,chipX+11,chipY+9,angle,color,4);
    c.fillStyle=color;c.fillText(caption,chipX+22,chipY+9);
    // Keep the pointer clear of the radio, radar, and mobile controls.
    const left=11,right=this.width-11,top=Math.min(chipY+(compact?24:27),this.height-20);
    const bottom=Math.min(this.height-10,Math.max(top+3,this.height-(this.height>this.width?76:65)));
    const sx=this.width/2+(target.x-this.camera.x)*this.camera.zoom;
    const sy=this.height/2+(target.y-this.camera.y)*this.camera.zoom;
    if(sx<left||sx>right||sy<top||sy>bottom){
      const ox=clamp(this.width/2+(leader.x-this.camera.x)*this.camera.zoom,left+1,right-1);
      const oy=clamp(this.height/2+(leader.y-this.camera.y)*this.camera.zoom,top+1,bottom-1);
      const vx=sx-ox,vy=sy-oy;
      let reach=Infinity;
      if(vx>0)reach=Math.min(reach,(right-ox)/vx);else if(vx<0)reach=Math.min(reach,(left-ox)/vx);
      if(vy>0)reach=Math.min(reach,(bottom-oy)/vy);else if(vy<0)reach=Math.min(reach,(top-oy)/vy);
      if(Number.isFinite(reach)){
        const px=Math.round(ox+vx*reach),py=Math.round(oy+vy*reach);
        c.fillStyle='rgba(17,37,32,.9)';c.beginPath();c.arc(px,py,9,0,TAU);c.fill();
        c.strokeStyle=rgba(color,.45);c.beginPath();c.arc(px,py,9,0,TAU);c.stroke();
        this.drawBearingArrow(c,px,py,Math.atan2(vy,vx),color,5);
      }
    }
    c.restore();
  }
  drawBearingArrow(c,x,y,angle,color,size) {
    c.save();c.translate(x,y);c.rotate(angle);c.fillStyle=color;
    c.beginPath();c.moveTo(size+1,0);c.lineTo(-size,-size*.85);c.lineTo(-size*.4,0);c.lineTo(-size,size*.85);c.closePath();c.fill();c.restore();
  }
  drawMinimap(c,state) {
    const mw=Math.min(68,Math.round(this.width*.25)),mh=Math.round(mw*.75),x=this.width-mw-7,y=7;
    const ww=state.world.width,wh=state.world.height;
    c.save();c.fillStyle='rgba(17,37,32,.87)';c.fillRect(x-2,y-2,mw+4,mh+4);c.strokeStyle='rgba(187,206,150,.42)';c.lineWidth=1;c.strokeRect(x-2.5,y-2.5,mw+5,mh+5);
    c.fillStyle='#52654a';c.fillRect(x,y,mw,mh);c.fillStyle='#3a6866';c.fillRect(x,y,mw,3);c.fillRect(x+mw-4,y,4,mh);
    for(const o of state.world.obstacles||[]){if(o.alive===false)continue;c.fillStyle=o.type==='hut'?'#a29b70':'#394e36';c.fillRect(x+o.x/ww*mw-1,y+o.y/wh*mh-1,2,2);}
    for(const p of state.civilians||[])if(!p.rescued){c.fillStyle='#b9ddcf';c.fillRect(x+p.x/ww*mw-1,y+p.y/wh*mh-1,2,2);}
    for(const e of state.enemies||[])if(e.alive){c.fillStyle=e.type==='zombie'?'#b5b879':'#d2a481';c.fillRect(x+e.x/ww*mw,y+e.y/wh*mh,1,1);}
    for(const s of state.soldiers||[])if(s.alive){c.fillStyle='#e4f3b8';c.fillRect(x+s.x/ww*mw-1,y+s.y/wh*mh-1,2,2);}
    if(state.extraction){c.strokeStyle='#dddb99';c.strokeRect(x+state.extraction.x/ww*mw-2,y+state.extraction.y/wh*mh-2,4,4);}
    const vw=this.width/this.camera.zoom/ww*mw,vh=this.height/this.camera.zoom/wh*mh;
    c.strokeStyle='rgba(228,239,191,.55)';c.strokeRect(x+this.camera.x/ww*mw-vw/2,y+this.camera.y/wh*mh-vh/2,vw,vh);
    c.restore();
  }
}
