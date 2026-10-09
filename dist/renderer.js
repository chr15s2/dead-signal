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
    this.width = 1; this.height = 1; this.cache = null; this.terrainWorld = null;
    this.lastTime = 0; this.initialized = false; this.lastState = null;
    this.objects = []; this.effects = []; this.lastEventId = 0; this.shake = 0;
    this.look = {x:0,y:0}; this.transform = {x:0,y:0,zoom:1};
    const margin=document.createElement('canvas');margin.width=margin.height=96;
    const mc=margin.getContext('2d'),mr=seeded(1402);mc.fillStyle='#596650';mc.fillRect(0,0,96,96);
    for(let i=0;i<35;i++){mc.fillStyle=i%2?'#65715a':'#526249';mc.fillRect(Math.floor(mr()*96),Math.floor(mr()*96),2,1);}
    this.marginPattern=this.ctx.createPattern(margin,'repeat');
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
    this.vignette=null;
  }
  reset() {
    // A restarted mission has a new state, even when its mission number is unchanged.
    this.initialized=false;this.lastState=null;this.lastTime=0;
    this.look.x=0;this.look.y=0;this.shake=0;this.effects.length=0;this.lastEventId=0;
  }
  screenToWorld(clientX,clientY) {
    const b=this.canvas.getBoundingClientRect();
    const t=this.transform;
    return { x:((clientX-b.left)/b.width*this.width-t.x)/t.zoom,
      y:((clientY-b.top)/b.height*this.height-t.y)/t.zoom };
  }
  worldToScreen(x,y) {
    const b=this.canvas.getBoundingClientRect();
    const t=this.transform;
    return { x:b.left+(x*t.zoom+t.x)/this.width*b.width,
      y:b.top+(y*t.zoom+t.y)/this.height*b.height };
  }
  makeTerrain(state) {
    const world=state.world; const w=world.width,h=world.height;
    const terrain=document.createElement('canvas'); terrain.width=w; terrain.height=h;
    const c=terrain.getContext('2d'); const r=seeded(1977+(Number(state.mission)+1||1)*137);
    c.imageSmoothingEnabled=false;
    c.fillStyle='#65705a'; c.fillRect(0,0,w,h);
    // Warm patches and lush grass grow across an original hand-shaped coastal map.
    for(let i=0;i<115;i++) {
      const x=r()*w,y=r()*h;
      c.fillStyle=['#64715a','#5f6c54','#6b745a','#626f58','#717a5f'][i%5];
      c.beginPath();c.ellipse(x,y,35+r()*85,15+r()*55,r()*TAU,0,TAU);c.fill();
    }
    // The sea follows the same shoreline that the simulation uses for collisions.
    const shoreline=world.coastline||[
      {x:-10,y:102},{x:180,y:47},{x:w-890,y:76},{x:w-645,y:54},
      {x:w-440,y:90},{x:w-260,y:60},{x:w-110,y:210},{x:w-72,y:h-705},
      {x:w-118,y:h-555},{x:w-62,y:h-420},{x:w-87,y:h-255},
      {x:w-51,y:h-110},{x:w-45,y:h+10}
    ];
    const coastPath=()=>{c.beginPath();shoreline.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));};
    coastPath();c.lineTo(w+20,h+20);c.lineTo(w+20,-20);c.lineTo(-20,-20);c.closePath();
    c.fillStyle='#315d5e';c.fill();
    coastPath();c.strokeStyle='#78968b';c.lineWidth=18;c.lineJoin='round';c.stroke();
    coastPath();c.strokeStyle='#bbb083';c.lineWidth=8;c.stroke();
    // Alternating bands of tiny broken surf are drawn by hand, not an image filter.
    for(let i=0;i<190;i++) {
      const x=r()*w,y=r()*46;
      c.fillStyle=i%2?'#518e88':'#609b8e';c.fillRect(x,y,6+r()*19,2);
      if(i%3===0)c.fillRect(w-30-r()*17,r()*h,2,9+r()*15);
    }
    c.save();c.beginPath();shoreline.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));
    c.lineTo(-20,h+20);c.closePath();c.clip();
    function path(points,width,color) {
      c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.lineJoin='round';c.beginPath();
      points.forEach((p,i)=>i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]));c.stroke();
    }
    const main=[[130,h-35],[218,970],[420,880],[510,698],[715,633],[810,470],[1030,389],[1200,260],[1380,220],[1450,240]];
    const branch=[[422,880],[625,952],[850,850],[1120,830],[1230,620],[1190,420]];
    path(main,80,'#5d664e');path(main,65,'#a29974');path(main,48,'#b3a782');path(main,33,'#bbaf8d');
    path(branch,63,'#5d664e');path(branch,47,'#a29974');path(branch,35,'#b3a782');
    path([[515,697],[327,540],[240,320],[450,215],[680,240]],47,'#8d885c');
    path([[515,697],[327,540],[240,320],[450,215],[680,240]],34,'#a39768');
    // Pixel-sized botanical texture; spacious bare ground keeps gameplay legible.
    for(let i=0;i<3600;i++) {
      const x=Math.floor(r()*w),y=Math.floor(95+r()*(h-95));
      if(x>w-125)continue;
      c.fillStyle=['#56634c','#738065','#7a836b','#5a694f','#818269','#68775c'][i%6];
      c.fillRect(x,y,1+Math.floor(r()*2),1+Math.floor(r()*2));
      if(i%13===0) {c.fillRect(x+2,y-3,1,4);c.fillRect(x-2,y-1,1,3);}
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
    for(let i=0;i<65;i++) {
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
    const decorations=world.decorations||[];
    this.staticDecorationCount=decorations.length;
    for(let i=0;i<decorations.length;i++){
      const d=decorations[i];if(d.type!=='grass'||i%3===0)this.drawDecoration(c,d,state);
    }
    // Original abandoned camp props add story without affecting navigation.
    for(const d of [
      {x:583,y:868,type:'wreck'}, {x:502,y:834,type:'crate'}, {x:522,y:840,type:'crate'},
      {x:573,y:853,type:'sandbags'}, {x:667,y:771,type:'bones'}, {x:688,y:499,type:'crate'},
      {x:720,y:541,type:'fence'}, {x:1210,y:451,type:'fence'}, {x:1111,y:803,type:'sandbags'},
      {x:1339,y:276,type:'crate'}, {x:1358,y:282,type:'crate'}, {x:989,y:892,type:'bones'}
    ])this.drawDecoration(c,d,state);
    c.restore();
    // A soft earth edge marks the playable land without framing it as a board.
    const left=c.createLinearGradient(0,0,32,0);left.addColorStop(0,'rgba(33,47,32,.21)');left.addColorStop(1,'rgba(33,47,32,0)');
    c.fillStyle=left;c.fillRect(0,0,32,h);
    const bottom=c.createLinearGradient(0,h-32,0,h);bottom.addColorStop(0,'rgba(33,47,32,0)');bottom.addColorStop(1,'rgba(33,47,32,.21)');
    c.fillStyle=bottom;c.fillRect(0,h-32,w,32);
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
  render(state,{preview=false,reducedMotion=false}={}) {
    if(!state?.world)return;
    if(this.lastState!==state){this.reset();this.lastState=state;}
    const now=performance.now(),dt=Math.min(.06,(now-this.lastTime)/1000||.016);this.lastTime=now;
    const world=state.world,w=world.width,h=world.height,time=state.time||0;
    if(this.terrainWorld!==world){this.terrainWorld=world;this.makeTerrain(state);}
    const soldiers=state.soldiers||[];
    let leader=null;for(const s of soldiers)if(s.alive&&(!leader||s.id===state.leaderId))leader=s;
    const portrait=this.height>this.width;
    // A phone sees both sides of a firefight. Sprite scale below preserves readability.
    const zoom=preview?(portrait?.43:.56):portrait?this.width/540:Math.min(.72,this.width/620,this.height/420);
    const safeTop=preview?0:Math.min(30,this.height*.12);
    const safeBottom=preview?0:Math.min(portrait?76:58,this.height*.30);
    const anchorY=(safeTop+this.height-safeBottom)/2;
    const direction=leader?.moving&&Number.isFinite(leader.moveAngle)?leader.moveAngle:null;
    const aimAhead=direction===null?0:Math.min(54,230*.23);
    const lookBlend=reducedMotion?1:1-Math.exp(-dt*3.2);
    this.look.x+=((direction===null?0:Math.cos(direction)*aimAhead)-this.look.x)*lookBlend;
    this.look.y+=((direction===null?0:Math.sin(direction)*aimAhead)-this.look.y)*lookBlend;
    let tx=(leader?.x??w/2)+this.look.x,ty=(leader?.y??h/2)+this.look.y+(this.height/2-anchorY)/zoom;
    if(preview){tx+=portrait?60:150;ty-=portrait?115:25;}
    if(!this.initialized){this.camera.x=tx;this.camera.y=ty;this.camera.zoom=zoom;this.initialized=true;}
    const follow=reducedMotion?1:1-Math.exp(-dt*7);
    this.camera.zoom+=(zoom-this.camera.zoom)*follow;
    if(state.status!=='paused'){this.camera.x+=(tx-this.camera.x)*follow;this.camera.y+=(ty-this.camera.y)*follow;}
    const halfW=this.width/2/this.camera.zoom,halfH=this.height/2/this.camera.zoom;
    if(preview){
      this.camera.x=clamp(this.camera.x,Math.min(halfW,w/2),Math.max(w-halfW,w/2));
      this.camera.y=clamp(this.camera.y,Math.min(halfH,h/2),Math.max(h-halfH,h/2));
    }else{
      // Small overscroll leaves room for thumbs while the island still fills the field.
      const marginX=portrait?50:80,marginY=120;
      this.camera.x=halfW>w/2+marginX?w/2:clamp(this.camera.x,halfW-marginX,w-halfW+marginX);
      this.camera.y=halfH>h/2+marginY?h/2:clamp(this.camera.y,halfH-marginY,h-halfH+marginY);
    }
    for(const event of state.events||[]){
      if(event.id<=this.lastEventId)continue;
      this.lastEventId=event.id;
      if(time-event.time>.7)continue;
      if(event.type==='explosion')this.effects.push({...event,duration:.42});
      if(event.type==='rescue'||event.type==='objective'||event.type==='extracted')this.effects.push({...event,duration:.9});
      if(!reducedMotion&&event.type==='explosion')this.shake=Math.max(this.shake,2.2);
      if(!reducedMotion&&event.type==='hit'&&event.team==='player')this.shake=Math.max(this.shake,1.1);
    }
    this.shake*=Math.exp(-dt*15);
    if(reducedMotion||preview)this.shake=0;
    const shakeX=Math.sin(time*67)*this.shake,shakeY=Math.cos(time*79)*this.shake*.6;
    // Hit testing uses this exact matrix, including shake. No hidden rounding offsets.
    this.transform.x=this.width/2-this.camera.x*this.camera.zoom+shakeX;
    this.transform.y=this.height/2-this.camera.y*this.camera.zoom+shakeY;
    this.transform.zoom=this.camera.zoom;
    this.bounds={left:this.camera.x-halfW-100,right:this.camera.x+halfW+100,top:this.camera.y-halfH-100,bottom:this.camera.y+halfH+100};
    this.personScale=clamp(.51/this.camera.zoom,1,1.8);
    const c=this.ctx;c.setTransform(1,0,0,1,0,0);c.imageSmoothingEnabled=false;
    c.fillStyle='#596650';c.fillRect(0,0,this.width,this.height);
    c.save();c.setTransform(this.camera.zoom,0,0,this.camera.zoom,this.transform.x,this.transform.y);
    c.fillStyle=this.marginPattern||'#596650';c.fillRect(this.bounds.left,this.bounds.top,this.bounds.right-this.bounds.left,this.bounds.bottom-this.bounds.top);
    c.fillStyle='#315d5e';c.fillRect(-300,-300,w+600,300);c.fillRect(w,-300,300,h+600);
    const shoreEnd=world.coastline?.at(-1)?.x??w-45;c.fillRect(shoreEnd,h,w-shoreEnd,300);
    c.drawImage(this.cache,0,0);
    // Destruction is a dynamic layer; the static island is never regenerated for debris.
    const decorations=world.decorations||[];
    for(let i=this.staticDecorationCount||0;i<decorations.length;i++){
      const d=decorations[i];if(this.visible(d.x,d.y))this.drawDecoration(c,d,state);
    }
    for(const o of world.obstacles||[])if(o.alive===false&&this.visible(o.x,o.y,o.w,o.h))this.drawRuins(c,o);
    if(leader&&(state.noise||0)>35&&!preview){
      const wave=(time*.65)%1;c.strokeStyle=`rgba(230,193,125,${(1-wave)*.15})`;c.lineWidth=1;
      c.beginPath();c.arc(leader.x,leader.y,25+wave*(state.noise||0)*1.2,0,TAU);c.stroke();
    }
    const ex=state.extraction;
    if(ex&&this.visible(ex.x,ex.y,ex.r,ex.r))this.drawExtraction(c,ex,time,reducedMotion);
    for(const person of state.civilians||[]){
      if(!person.rescued&&this.visible(person.x,person.y)){
        c.strokeStyle='#b6e4d2';c.lineWidth=1.5;c.setLineDash([3,5]);c.beginPath();c.arc(person.x,person.y,23,0,TAU);c.stroke();c.setLineDash([]);
      }
    }
    if(state.target&&leader&&!preview){
      const path=leader.path;
      if(path?.length){
        c.strokeStyle='rgba(175,222,206,.65)';c.lineWidth=1.5;c.setLineDash([3,5]);c.beginPath();c.moveTo(leader.x,leader.y);
        for(const waypoint of path)c.lineTo(waypoint.x,waypoint.y);c.stroke();c.setLineDash([]);
      }
      c.strokeStyle='#bbebd7';c.lineWidth=1.5;c.beginPath();c.arc(state.target.x,state.target.y,8,0,TAU);c.stroke();
      c.fillStyle='#d7f3e7';c.fillRect(state.target.x-2,state.target.y-2,4,4);
    }
    for(const dead of state.corpses||[])if(this.visible(dead.x,dead.y))this.drawCorpse(c,dead,state);
    const objects=this.objects;objects.length=0;
    for(const o of world.obstacles||[])if(o.alive!==false&&this.visible(o.x,o.y,o.w,o.h))objects.push(o);
    for(const s of soldiers)if(s.alive&&this.visible(s.x,s.y))objects.push(s);
    for(const e of state.enemies||[])if(e.alive&&this.visible(e.x,e.y))objects.push(e);
    for(const p of state.civilians||[])if(p.alive!==false&&this.visible(p.x,p.y))objects.push(p);
    objects.sort((a,b)=>(a.y+(a.h||0))-(b.y+(b.h||0)));
    for(const o of objects){
      if(o.w!==undefined)this.drawObstacle(c,o,state);
      else this.drawPerson(c,o,o.name?'squad':o.type==='zombie'?'zombie':o.type==='soldier'?'enemy':'civilian',state,o.id===state.leaderId);
    }
    for(const b of state.bullets||[])if(this.visible(b.x,b.y)){
      const d=Math.hypot(b.vx||0,b.vy||0)||1,dx=(b.vx||0)/d,dy=(b.vy||0)/d;
      c.strokeStyle=b.team==='enemy'?'#eaac6d':'#f0e2ac';c.lineWidth=1.4/this.camera.zoom;
      c.beginPath();c.moveTo(b.x,b.y-4);c.lineTo(b.x-dx*11,b.y-dy*11-4);c.stroke();
      c.fillStyle='#fff4d4';c.fillRect(b.x-1.5,b.y-5.5,3,3);
    }
    for(const g of state.thrownGrenades||[])if(this.visible(g.x,g.y)){
      const t=clamp((g.time||0)/(g.duration||.65),0,1);
      c.strokeStyle='rgba(240,185,102,.65)';c.lineWidth=1.5;c.setLineDash([3,3]);c.beginPath();c.arc(g.tx,g.ty,17+(1-t)*12,0,TAU);c.stroke();c.setLineDash([]);
      c.fillStyle='rgba(25,38,25,.35)';c.beginPath();c.ellipse(g.x,g.y,5,3,0,0,TAU);c.fill();
      c.save();c.translate(g.x,g.y-(g.height||0)-4);c.rotate(t*TAU);c.fillStyle='#1e3b31';c.fillRect(-3,-3,6,6);c.fillStyle='#c6d1a0';c.fillRect(-2,-2,4,4);c.fillStyle='#ebce8e';c.fillRect(0,-4,2,2);c.restore();
    }
    for(const p of state.particles||[])if(this.visible(p.x,p.y))this.drawParticle(c,p);
    let write=0;for(const event of this.effects){
      const age=time-event.time;if(age>event.duration)continue;
      this.effects[write++]=event;if(this.visible(event.x,event.y))this.drawEvent(c,event,age,reducedMotion);
    }this.effects.length=write;
    c.restore();this.drawVignette(c);
    if(!preview){this.drawMinimap(c,state);if(state.status==='playing')this.drawObjectiveDirection(c,state,leader,safeTop,safeBottom);}
  }
  visible(x,y,w=0,h=0){const b=this.bounds;return x+w>=b.left&&x<=b.right&&y+h>=b.top&&y<=b.bottom;}
  drawExtraction(c,ex,time,reducedMotion){
    const active=ex.active,color=ex.regrouping?'#e6c18c':active?'#bee5b6':'#aaa57a';
    c.save();c.translate(ex.x,ex.y);
    c.globalAlpha=active?.12:.035;c.fillStyle=color;c.beginPath();c.arc(0,0,ex.r,0,TAU);c.fill();c.globalAlpha=1;
    c.strokeStyle=ex.regrouping?'#d8b178':active?'#8bbb97':'#9c9c77';c.lineWidth=2;c.setLineDash([5,8]);c.beginPath();c.arc(0,0,ex.r,0,TAU);c.stroke();c.setLineDash([]);
    c.strokeStyle=ex.regrouping?'#e6c18c':active?'#d9f1b2':'#b7b183';c.lineWidth=2;
    for(let i=0;i<4;i++){const a=i*Math.PI/2,x=Math.cos(a)*(ex.r-14),y=Math.sin(a)*(ex.r-14);c.save();c.translate(x,y);c.rotate(a);c.beginPath();c.moveTo(-8,-6);c.lineTo(-2,0);c.lineTo(-8,6);c.stroke();c.restore();}
    c.fillStyle=active?'#d1efad':'#b8b187';c.fillRect(-10,-2,20,4);c.fillRect(-2,-10,4,20);
    if(active){const pulse=reducedMotion?0:Math.sin(time*2.5)*2;c.strokeStyle='#c4d99e';c.lineWidth=1;c.beginPath();c.arc(0,0,15+pulse,0,TAU);c.stroke();}
    if(ex.progress>0){c.lineWidth=5;c.strokeStyle='#ecf7b8';c.beginPath();c.arc(0,0,ex.r-5,-Math.PI/2,-Math.PI/2+TAU*clamp(ex.progress,0,1));c.stroke();}
    c.restore();
  }
  drawRuins(c,o){
    const x=o.x,y=o.y,w=o.w,h=o.h;c.save();
    c.fillStyle='#505747';c.fillRect(x+2,y+2,w-4,h-4);
    c.fillStyle='#72725b';c.fillRect(x+5,y+5,w-10,4);c.fillRect(x+5,y+h-8,w-10,3);
    c.fillStyle='#383d33';c.fillRect(x+w*.22,y+h*.25,w*.58,h*.40);
    if(o.type==='hut'){
      c.fillStyle='#79715a';c.fillRect(x+8,y+8,5,h-17);c.fillRect(x+w-13,y+10,5,h-18);
      c.strokeStyle='#4b4737';c.lineWidth=4;c.beginPath();c.moveTo(x+15,y+13);c.lineTo(x+w-23,y+h-17);c.moveTo(x+w-17,y+17);c.lineTo(x+27,y+h-11);c.stroke();
      c.fillStyle='#91816a';c.fillRect(x+30,y+18,18,3);c.fillRect(x+17,y+h-22,22,3);
    }else{c.fillStyle='#8f8060';c.fillRect(x+w*.2,y+h*.3,w*.6,3);}
    c.restore();
  }
  drawEvent(c,event,age,reducedMotion){
    if(event.type==='explosion'){
      if(age<.11&&!reducedMotion){const r=10+age*180;c.fillStyle=`rgba(255,237,174,${(.11-age)*5})`;c.beginPath();c.arc(event.x,event.y,r,0,TAU);c.fill();}
    }else{
      const t=age/event.duration;c.globalAlpha=(1-t)*.6;c.strokeStyle='#d6eed1';c.lineWidth=2;c.beginPath();c.arc(event.x,event.y,20+t*35,0,TAU);c.stroke();c.globalAlpha=1;
    }
  }
  drawObstacle(c,o,state) {
    const w=o.w||28,h=o.h||28,x=Math.round(o.x+w/2),y=Math.round(o.y+h/2);
    c.save();c.translate(x,y);
    // The ground rim marks the physical cover footprint, rather than its roof shadow.
    c.fillStyle='rgba(29,41,31,.16)';c.fillRect(-w/2,-h/2,w,h);
    if(o.type==='hut'){c.strokeStyle='#394637';c.lineWidth=2;c.strokeRect(-w/2,-h/2,w,h);}
    if(o.type==='tree'){
      // Layered fan palms have chunky, unmistakable pixel silhouettes.
      c.fillStyle='rgba(26,38,28,.25)';c.beginPath();c.ellipse(10,6,w*.65,h*.35,0,0,TAU);c.fill();
      c.fillStyle='#574e33';c.fillRect(-3,-h*.44,7,h*.58);c.fillStyle='#a08751';c.fillRect(-1,-h*.43,2,h*.53);
      const cy=-h*.32, reach=Math.max(w*.58,20);
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
    const time=state.time||0,moving=Boolean(p.moving);
    const phase=Number.isFinite(p.walkPhase)?p.walkPhase:time*(zombie?7:11)+(Number(p.id)||0)*2;
    const step=moving?Math.sin(phase)*2.2:0,bob=moving?Math.abs(Math.sin(phase))*.8:0;
    const hit=(p.hitFlash||0)>0,scale=this.personScale||1;
    const moveAngle=Number.isFinite(p.moveAngle)?p.moveAngle:angle;
    const footX=Math.cos(moveAngle)*step,footY=Math.sin(moveAngle)*step;
    c.save();c.translate(x,y);c.scale(scale,scale);
    c.fillStyle='rgba(20,34,28,.32)';c.beginPath();c.ellipse(1,5,zombie?8:7,3.5,0,0,TAU);c.fill();
    if(type==='squad'){
      c.strokeStyle=leader?'#b8ead7':'rgba(124,196,173,.62)';c.lineWidth=leader?1.5:1;
      c.beginPath();c.ellipse(0,5,leader?10:8,leader?5:4,0,0,TAU);c.stroke();
      if(leader){c.fillStyle='#c6f0df';c.fillRect(-3,-25,6,2);c.fillRect(-2,-23,4,2);c.fillRect(-1,-21,2,1);}
    }
    if(enemy&&p.reaction>0){
      c.strokeStyle='#ebc48b';c.lineWidth=1;c.beginPath();c.moveTo(0,-29);c.lineTo(3,-25);c.lineTo(0,-21);c.lineTo(-3,-25);c.closePath();c.stroke();
    }
    // Locomotion belongs to the feet; weapon aim never changes the marching direction.
    c.fillStyle=zombie?'#343e33':civilian?'#47584e':'#243b34';
    c.fillRect(Math.round(-5+footX),Math.round(3+footY),4,5);
    c.fillRect(Math.round(2-footX),Math.round(3-footY),4,5);
    c.translate(0,-bob);
    const coat=hit?'#e2d7b5':zombie?'#798565':civilian?'#c2ad7c':enemy?'#ad8755':'#548577';
    c.fillStyle='#25372f';c.fillRect(-7,-10,14,14);c.fillStyle=coat;c.fillRect(-5,-9,10,12);
    c.fillStyle=zombie?'#a7b686':civilian?'#dbc698':enemy?'#c9ab75':'#8eb9a0';c.fillRect(-4,-9,3,2);c.fillRect(-4,-5,1,5);
    c.fillStyle=zombie?'#51523e':civilian?'#9b8f69':enemy?'#715b3e':'#3e6250';c.fillRect(-4,0,8,3);
    if(!zombie&&!civilian){
      c.fillStyle=enemy?'#69593f':'#345b4f';c.fillRect(-3,-7,6,6);c.fillStyle=enemy?'#d5b782':'#a1c4a5';c.fillRect(-2,-5,2,2);
      c.fillStyle=enemy?'#d8af69':'#cae7d2';c.fillRect(4,-8,2,2);
    }
    const dx=Math.cos(angle),dy=Math.sin(angle),faceX=Math.round(dx*1.5);
    if(zombie){
      const sway=moving?Math.sin(phase*.5):0;
      c.fillStyle='#263a30';c.fillRect(-6+faceX,-18,12,11);
      c.fillStyle=hit?'#f0dec0':'#bdcba0';
      c.fillRect(Math.round(dx*6)-2,Math.round(dy*6)-7+Math.round(sway),4,6);
      c.fillRect(Math.round(dx*4)-6,Math.round(dy*4)-5-Math.round(sway),3,6);
      c.fillRect(-5+faceX,-17,10,9);c.fillRect(-3,-9,6,3);c.fillStyle='#d0d9af';c.fillRect(-4+faceX,-16,7,2);
      c.fillStyle='#263c30';c.fillRect(-4+faceX,-13,3,3);c.fillRect(2+faceX,-13,2,3);c.fillRect(-2,-8,4,1);
      c.fillStyle='#d0cc9d';c.fillRect(-1+faceX,-10,2,2);c.fillStyle='#835c49';c.fillRect(3,-4,2,5);
      // Ragged hem and exposed skin make the infected distinct at a glance.
      c.fillStyle='#bbc393';c.fillRect(-4,2,2,3);c.fillStyle='#515541';c.fillRect(1,1,2,3);
    }else{
      c.fillStyle=hit?'#f7e6c5':'#e0c99c';c.fillRect(-4+faceX,-14,8,6);
      c.fillStyle=civilian?'#514536':enemy?'#877043':'#2e6157';c.fillRect(-5+faceX,-18,10,6);c.fillRect(-6+faceX,-14,12,2);
      c.fillStyle=civilian?'#7b6241':enemy?'#c7aa6d':'#79ae98';c.fillRect(-4+faceX,-18,7,2);
      if(!civilian){c.fillStyle=enemy?'#ddbd7c':'#a8dbc1';c.fillRect(-4+faceX,-15,2,1);}
      c.fillStyle='#344a3c';c.fillRect(dx>0?2:-3,-11,2,2);
      if(civilian){
        c.fillStyle='#e4cf9c';c.fillRect(-8,-8,3,6);c.fillRect(5,-8,3,6);
        if(!p.rescued){c.fillStyle='#cbeedb';c.fillRect(-1,-30,2,6);c.fillRect(-1,-22,2,2);}
        else{c.fillStyle='#bce1c4';c.fillRect(-2,-24,5,2);c.fillRect(1,-26,2,4);}
      }else{
        const recoil=(p.shootFlash||0)>0?1.5:0;c.save();c.translate(0,-4);c.rotate(angle);c.translate(-recoil,0);
        c.fillStyle='#d9c9a0';c.fillRect(3,-2,5,4);c.fillStyle='#233d34';c.fillRect(4,-2,13,3);
        c.fillStyle='#849280';c.fillRect(13,-2,5,1);c.fillStyle='#1e322d';c.fillRect(9,0,3,4);
        if(p.shootFlash>0){c.fillStyle='#f9e7a5';c.fillRect(19,-2,5,3);c.fillRect(21,-4,2,7);c.fillStyle='#e7b563';c.fillRect(24,-1,3,2);}
        c.restore();
      }
    }
    if(p.hp!==undefined&&p.maxHp&&(p.hp<p.maxHp||leader)){
      const health=clamp(p.hp/p.maxHp,0,1);c.fillStyle='#233c31';c.fillRect(-8,12,16,3);
      c.fillStyle=type==='squad'?(health<.30?'#ed9568':'#a8dec1'):zombie?'#bcc68c':'#dbb16e';
      c.fillRect(-7,13,Math.ceil(14*health),1);
    }
    c.restore();
  }
  drawCorpse(c,p,state) {
    const age=Math.max(0,(state.time||0)-(p.time??-10)),fall=clamp(age/.24,0,1);
    const zombie=p.type==='zombie',enemy=p.type==='soldier';
    c.save();c.translate(Math.round(p.x),Math.round(p.y));c.scale(this.personScale||1,this.personScale||1);
    c.rotate((Number.isFinite(p.angle)?p.angle:0)+.6);
    if(fall<1)c.scale(.5+fall*.5,1+(1-fall)*.5);
    c.fillStyle='rgba(38,43,31,.2)';c.beginPath();c.ellipse(0,3,12,4,0,0,TAU);c.fill();
    c.fillStyle=zombie?'#60694e':enemy?'#88704b':'#42675a';c.fillRect(-6,-3,12,6);
    c.fillStyle=zombie?'#a4af85':'#b8a985';c.fillRect(5,-4,5,5);c.fillStyle='#354638';c.fillRect(-11,-2,5,3);c.fillRect(-10,3,5,2);
    if(p.name){c.strokeStyle='#8cb7a0';c.lineWidth=.8;c.beginPath();c.moveTo(-3,-1);c.lineTo(2,-1);c.moveTo(0,-3);c.lineTo(0,2);c.stroke();}
    c.restore();
  }
  drawParticle(c,p) {
    const alpha=clamp((p.life||0)/(p.maxLife||1),0,1);c.save();c.globalAlpha=alpha;
    const type=p.type||'spark';
    if(type==='ring'){
      c.lineWidth=1.3/this.camera.zoom;c.strokeStyle=p.color||'#e1dcb4';c.beginPath();c.arc(p.x,p.y,(p.radius||25)*(1-alpha*.7),0,TAU);c.stroke();
    }else if(type==='smoke'||type==='dust'){
      const size=6+(1-alpha)*13;c.globalAlpha=alpha*.32;c.fillStyle=p.color||'#b8b59a';c.fillRect(Math.round(p.x-size/2),Math.round(p.y-size/2),size,size);
    }else if(type==='explosion'||type==='fire'){
      const size=3+alpha*6;c.fillStyle=p.color||'#ecc573';c.fillRect(Math.round(p.x-size/2),Math.round(p.y-size/2),size,size);
    }else{c.fillStyle=p.color||(type==='blood'?'#8f664b':'#e2d5a1');const size=type==='hit'?3:2;c.fillRect(Math.round(p.x),Math.round(p.y),size,size);}
    c.restore();
  }
  drawVignette(c) {
    if(!this.vignette){
      const canvas=document.createElement('canvas');canvas.width=this.width;canvas.height=this.height;
      const v=canvas.getContext('2d'),g=v.createRadialGradient(this.width/2,this.height/2,Math.min(this.width,this.height)*.35,this.width/2,this.height/2,Math.max(this.width,this.height)*.73);
      g.addColorStop(0,'rgba(13,28,23,0)');g.addColorStop(1,'rgba(13,28,23,.10)');v.fillStyle=g;v.fillRect(0,0,this.width,this.height);this.vignette=canvas;
    }
    c.drawImage(this.vignette,0,0);
  }
  drawObjectiveDirection(c,state,leader,safeTop=30,safeBottom=76) {
    if(!leader)return;
    let target=null,nearest=Infinity,color='#c2e8d7';
    for(const person of state.civilians||[])if(!person.rescued&&person.alive!==false){
      const d=Math.hypot(person.x-leader.x,person.y-leader.y);if(d<nearest){target=person;nearest=d;}
    }
    if(!target&&state.extraction?.active){target=state.extraction;color='#d6e9ac';}
    if(!target&&Number(state.mission)===2){
      for(const enemy of state.enemies||[])if(enemy.alive){const d=Math.hypot(enemy.x-leader.x,enemy.y-leader.y);if(d<nearest){target=enemy;nearest=d;color='#dfb37c';}}
    }
    const edges={left:10,right:this.width-10,top:safeTop+9,bottom:Math.max(safeTop+28,this.height-safeBottom-9)};
    if(target)this.drawEdgeMarker(c,target,leader,edges,color,true);
    // A nearby offscreen threat receives a small bearing, without obscuring the objective.
    let threat=null,distance=Infinity;
    for(const enemy of state.enemies||[])if(enemy.alive&&enemy!==target){
      const d=Math.hypot(enemy.x-leader.x,enemy.y-leader.y);
      const sx=enemy.x*this.transform.zoom+this.transform.x,sy=enemy.y*this.transform.zoom+this.transform.y;
      if(d<380&&d<distance&&(sx<edges.left||sx>edges.right||sy<edges.top||sy>edges.bottom)){threat=enemy;distance=d;}
    }
    if(threat)this.drawEdgeMarker(c,threat,leader,edges,threat.type==='zombie'?'#b9c68d':'#e3ac75',false);
  }
  drawEdgeMarker(c,target,leader,edges,color,objective){
    const t=this.transform,sx=target.x*t.zoom+t.x,sy=target.y*t.zoom+t.y;
    if(sx>=edges.left&&sx<=edges.right&&sy>=edges.top&&sy<=edges.bottom)return;
    const ox=clamp(leader.x*t.zoom+t.x,edges.left+1,edges.right-1),oy=clamp(leader.y*t.zoom+t.y,edges.top+1,edges.bottom-1);
    const vx=sx-ox,vy=sy-oy;let reach=Infinity;
    if(vx>0)reach=Math.min(reach,(edges.right-ox)/vx);else if(vx<0)reach=Math.min(reach,(edges.left-ox)/vx);
    if(vy>0)reach=Math.min(reach,(edges.bottom-oy)/vy);else if(vy<0)reach=Math.min(reach,(edges.top-oy)/vy);
    if(!Number.isFinite(reach))return;
    const x=Math.round(ox+vx*reach),radius=objective?8:5;
    let y=Math.round(oy+vy*reach);
    const radarWidth=Math.min(63,Math.round(this.width*.23)),radarBottom=7+Math.round(radarWidth*.75)+3;
    if(x>this.width-radarWidth-12&&y<radarBottom+radius+3)y=radarBottom+radius+3;
    c.fillStyle='rgba(24,43,36,.87)';c.beginPath();c.arc(x,y,radius,0,TAU);c.fill();
    if(objective){c.strokeStyle=rgba(color,.5);c.lineWidth=1;c.beginPath();c.arc(x,y,radius,0,TAU);c.stroke();}
    this.drawBearingArrow(c,x,y,Math.atan2(vy,vx),color,objective?4:3);
  }
  drawBearingArrow(c,x,y,angle,color,size) {
    c.save();c.translate(x,y);c.rotate(angle);c.fillStyle=color;
    c.beginPath();c.moveTo(size+1,0);c.lineTo(-size,-size*.85);c.lineTo(-size*.4,0);c.lineTo(-size,size*.85);c.closePath();c.fill();c.restore();
  }
  drawMinimap(c,state) {
    const mw=Math.min(63,Math.round(this.width*.23)),mh=Math.round(mw*.75),x=this.width-mw-7,y=7;
    const ww=state.world.width,wh=state.world.height;
    c.save();c.fillStyle='rgba(22,41,35,.93)';c.fillRect(x-3,y-3,mw+6,mh+6);c.strokeStyle='rgba(162,193,167,.45)';c.lineWidth=1;c.strokeRect(x-3.5,y-3.5,mw+7,mh+7);
    c.fillStyle='#53684f';c.fillRect(x,y,mw,mh);
    c.save();c.beginPath();c.rect(x,y,mw,mh);c.clip();
    const shore=state.world.coastline;
    if(shore){c.fillStyle='#345d5a';c.beginPath();shore.forEach((p,i)=>i?c.lineTo(x+p.x/ww*mw,y+p.y/wh*mh):c.moveTo(x+p.x/ww*mw,y+p.y/wh*mh));c.lineTo(x+mw,y+mh);c.lineTo(x+mw,y);c.lineTo(x,y);c.closePath();c.fill();}
    for(const o of state.world.obstacles||[])if(o.alive!==false){c.fillStyle=o.type==='hut'?'#a69d7b':'#40553f';c.fillRect(x+o.x/ww*mw,y+o.y/wh*mh,Math.max(1,o.w/ww*mw),Math.max(1,o.h/wh*mh));}
    if(state.extraction){const ex=state.extraction;c.strokeStyle=ex.active?'#dbecad':'#aba878';c.strokeRect(x+ex.x/ww*mw-2,y+ex.y/wh*mh-2,4,4);}
    for(const p of state.civilians||[])if(!p.rescued&&p.alive!==false){c.fillStyle='#caecda';c.fillRect(Math.round(x+p.x/ww*mw)-1,Math.round(y+p.y/wh*mh)-1,2,2);}
    for(const e of state.enemies||[])if(e.alive){c.fillStyle=e.type==='zombie'?'#bbc48b':'#e0ac70';c.fillRect(Math.round(x+e.x/ww*mw),Math.round(y+e.y/wh*mh),1,1);}
    const vw=this.width/this.camera.zoom/ww*mw,vh=this.height/this.camera.zoom/wh*mh;
    c.strokeStyle='rgba(211,233,205,.43)';c.lineWidth=.7;c.strokeRect(clamp(x+this.camera.x/ww*mw-vw/2,x,x+mw),clamp(y+this.camera.y/wh*mh-vh/2,y,y+mh),Math.min(vw,mw),Math.min(vh,mh));
    for(const s of state.soldiers||[])if(s.alive){
      const px=Math.round(x+s.x/ww*mw),py=Math.round(y+s.y/wh*mh);c.fillStyle='#c5f1d8';c.fillRect(px-1,py-1,2,2);
      if(s.id===state.leaderId){c.strokeStyle='#e3f5df';c.lineWidth=.8;c.strokeRect(px-2,py-2,4,4);}
    }
    c.restore();c.restore();
  }
}
