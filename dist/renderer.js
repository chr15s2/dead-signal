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
    const mc=margin.getContext('2d'),mr=seeded(1402);mc.fillStyle='#4f7958';mc.fillRect(0,0,96,96);
    for(let i=0;i<35;i++){mc.fillStyle=i%2?'#648660':'#456e4c';mc.fillRect(Math.floor(mr()*96),Math.floor(mr()*96),2,1);}
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
    const world=state.world,w=world.width,h=world.height;
    const terrain=document.createElement('canvas');terrain.width=w;terrain.height=h;
    const c=terrain.getContext('2d'),r=seeded(1977+(Number(state.mission)+1||1)*137);
    c.imageSmoothingEnabled=false;c.fillStyle='#587f5e';c.fillRect(0,0,w,h);
    const shoreline=world.coastline||[
      {x:-10,y:102},{x:180,y:47},{x:w-890,y:76},{x:w-645,y:54},{x:w-440,y:90},{x:w-260,y:60},
      {x:w-110,y:210},{x:w-72,y:h-705},{x:w-118,y:h-555},{x:w-62,y:h-420},{x:w-87,y:h-255},
      {x:w-51,y:h-110},{x:w-45,y:h+10}
    ];
    const coastPath=()=>{c.beginPath();shoreline.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));};
    const seaPath=()=>{coastPath();c.lineTo(w+20,h+20);c.lineTo(w+20,-20);c.lineTo(-20,-20);c.closePath();};
    const landPath=()=>{coastPath();c.lineTo(-20,h+20);c.closePath();};
    const blob=(x,y,rx,ry,color)=>{
      c.fillStyle=color;c.beginPath();
      for(let i=0;i<13;i++){const a=i/12*TAU,k=.79+r()*.28,px=Math.round((x+Math.cos(a)*rx*k)/4)*4,py=Math.round((y+Math.sin(a)*ry*k)/4)*4;i?c.lineTo(px,py):c.moveTo(px,py);}
      c.closePath();c.fill();
    };
    // Broad, authored clearings are interrupted by groves rather than random camouflage.
    for(const [x,y,rx,ry] of [[275,790,235,175],[520,495,250,200],[880,655,260,190],[1230,325,230,190],[1050,970,235,120]]){
      blob(x,y,rx,ry,'#668961');blob(x-25,y-18,rx*.61,ry*.67,'#6f9267');
    }
    for(const tree of world.obstacles||[])if(tree.type==='tree'){
      const x=tree.x+tree.w/2,y=tree.y+tree.h/2;
      blob(x+14,y+9,40+r()*27,24+r()*18,'#49754f');
      blob(x+23,y+14,21+r()*18,12+r()*12,'#426d4b');
      // Filtered afternoon light breaks the ground into small, quiet patches.
      for(let i=0;i<3;i++)blob(x-28+r()*53,y-22+r()*34,11+r()*12,5+r()*7,'#769a6a');
    }
    c.save();seaPath();c.clip();
    const depth=c.createLinearGradient(0,0,w,h);depth.addColorStop(0,'#28767a');depth.addColorStop(.55,'#236c74');depth.addColorStop(1,'#205b69');
    c.fillStyle=depth;c.fillRect(0,0,w,h);
    coastPath();c.lineJoin='round';c.strokeStyle='#318e88';c.lineWidth=82;c.stroke();
    coastPath();c.strokeStyle='#54aa99';c.lineWidth=42;c.stroke();
    coastPath();c.strokeStyle='#83c8b0';c.lineWidth=16;c.stroke();
    for(let i=0;i<200;i++){
      const x=Math.floor(r()*w),y=Math.floor(r()*h);c.fillStyle=i%3?'#377e80':'#3f8c87';c.fillRect(x,y,11+r()*24,2);
    }
    c.restore();
    this.waterMarks=[];
    for(let i=1;i<shoreline.length;i++){
      const a=shoreline[i-1],b=shoreline[i],d=Math.hypot(b.x-a.x,b.y-a.y),dx=(b.x-a.x)/d,dy=(b.y-a.y)/d;
      for(let t=15;t<d;t+=35){
        const x=a.x+dx*t,y=a.y+dy*t,offset=9+r()*10;
        c.strokeStyle='#c5e5c9';c.lineWidth=2;c.beginPath();c.moveTo(x+dy*3,y-dx*3);c.lineTo(x+dx*(9+r()*11)+dy*3,y+dy*(9+r()*11)-dx*3);c.stroke();
        this.waterMarks.push({x:x+dy*offset,y:y-dx*offset,dx,dy,length:8+r()*17,phase:r()*TAU});
      }
    }
    c.save();landPath();c.clip();
    coastPath();c.strokeStyle='#d6c997';c.lineWidth=30;c.stroke();
    coastPath();c.strokeStyle='#ebdfb2';c.lineWidth=9;c.stroke();
    const main=[[130,h-35],[218,970],[420,880],[510,698],[715,633],[810,470],[1030,389],[1200,260],[1380,220],[1450,240]];
    const branch=[[422,880],[625,952],[850,850],[1120,830],[1230,620],[1190,420]];
    const upland=[[515,697],[327,540],[240,320],[450,215],[680,240]];
    const path=(points,width,color)=>{
      c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.lineJoin='round';c.beginPath();
      points.forEach((p,i)=>i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]));c.stroke();
    };
    for(const [points,width]of [[main,66],[branch,48],[upland,36]]){
      path(points,width+15,'#48734f');path(points,width+6,'#a79968');path(points,width,'#cdb481');path(points,width-14,'#dcc595');
    }
    const trailDistance=(x,y)=>{
      let best=Infinity;
      for(const points of [main,branch,upland])for(let i=1;i<points.length;i++){
        const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],t=clamp(((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy),0,1);
        best=Math.min(best,Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t));
      }
      return best;
    };
    // Sand grains, windblown grass and small stones stay low contrast beneath the actors.
    for(let i=0;i<2800;i++){
      const x=Math.floor(r()*w),y=Math.floor(r()*h),onRoad=trailDistance(x,y)<23;
      c.fillStyle=onRoad?(i%3?'#c4aa77':'#ead3a2'):['#618961','#7c9d70','#4d7753','#769367'][i%4];
      c.fillRect(x,y,onRoad?2+r()*3:1+r()*2,onRoad?1:2);
    }
    for(const points of [main,branch])for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],d=Math.hypot(b[0]-a[0],b[1]-a[1]),dx=(b[0]-a[0])/d,dy=(b[1]-a[1])/d;
      for(let t=6;t<d;t+=12){
        c.fillStyle='#b59c6a';c.fillRect(Math.round(a[0]+dx*t-dy*12),Math.round(a[1]+dy*t+dx*12),3,2);
        c.fillRect(Math.round(a[0]+dx*t+dy*12),Math.round(a[1]+dy*t-dx*12),3,2);
        if(t%36===6){c.fillStyle='#ead4a7';c.fillRect(Math.round(a[0]+dx*t),Math.round(a[1]+dy*t),5,1);}
      }
    }
    for(const tree of world.obstacles||[])if(tree.type==='tree'){
      for(let i=0;i<6;i++){
        const x=tree.x-34+r()*83,y=tree.y-20+r()*66;
        if(trailDistance(x,y)<39)continue;
        this.drawDecoration(c,{type:'fern',x,y,variant:i},state);
      }
    }
    const decorations=world.decorations||[];this.staticDecorationCount=decorations.length;
    for(let i=0;i<decorations.length;i++){
      const d=decorations[i];if(d.type!=='grass'||i%3===0){if(d.type==='grass'&&trailDistance(d.x,d.y)<30)continue;this.drawDecoration(c,d,state);}
    }
    for(const d of [
      {x:583,y:868,type:'wreck'}, {x:502,y:834,type:'crate'}, {x:522,y:840,type:'crate'},
      {x:573,y:853,type:'sandbags'}, {x:667,y:771,type:'bones'}, {x:688,y:499,type:'crate'},
      {x:720,y:541,type:'fence'}, {x:1210,y:451,type:'fence'}, {x:1111,y:803,type:'sandbags'},
      {x:1339,y:276,type:'crate'}, {x:1358,y:282,type:'crate'}, {x:989,y:892,type:'bones'}
    ])this.drawDecoration(c,d,state);
    c.restore();
    const left=c.createLinearGradient(0,0,32,0);left.addColorStop(0,'rgba(24,61,35,.16)');left.addColorStop(1,'rgba(24,61,35,0)');c.fillStyle=left;c.fillRect(0,0,32,h);
    const bottom=c.createLinearGradient(0,h-32,0,h);bottom.addColorStop(0,'rgba(24,61,35,0)');bottom.addColorStop(1,'rgba(24,61,35,.16)');c.fillStyle=bottom;c.fillRect(0,h-32,w,32);
    this.cache=terrain;this.obstacleArt=new WeakMap();
  }
  drawDecoration(c,d,state) {
    c.save();c.translate(Math.round(d.x),Math.round(d.y));
    switch(d.type){
      case 'sandbag':case 'sandbags':
        c.fillStyle='rgba(24,61,35,.27)';c.fillRect(-22,-3,46,10);
        for(let i=-20;i<24;i+=11){c.fillStyle='#9b946b';c.fillRect(i,-7,10,7);c.fillStyle='#d1c491';c.fillRect(i+1,-7,8,3);c.fillStyle='#817e56';c.fillRect(i+1,-1,8,1);c.fillStyle='#aca06d';c.fillRect(i+7,-4,2,2);}break;
      case 'fence':
        c.strokeStyle='#758b71';c.lineWidth=1;c.beginPath();c.moveTo(-27,-6);c.lineTo(27,-6);c.moveTo(-27,0);c.lineTo(27,0);c.stroke();
        for(let i=-25;i<=25;i+=25){c.fillStyle='#635a3a';c.fillRect(i,-14,3,20);c.fillStyle='#bb9d64';c.fillRect(i,-14,1,18);c.fillStyle='#a6aa7c';c.fillRect(i-3,-7,7,1);}break;
      case 'crate':case 'supplies':
        c.fillStyle='rgba(24,61,35,.27)';c.fillRect(-10,-3,25,12);c.fillStyle='#594d34';c.fillRect(-11,-11,23,18);
        c.fillStyle='#92744a';c.fillRect(-10,-10,21,14);c.fillStyle='#be9a60';c.fillRect(-9,-10,18,3);
        c.fillStyle='#d0af79';c.fillRect(-9,-8,2,11);c.fillRect(7,-8,2,11);c.fillRect(-8,1,16,2);
        c.strokeStyle='#665436';c.lineWidth=2;c.beginPath();c.moveTo(-6,-6);c.lineTo(6,-1);c.stroke();
        c.fillStyle='#ecd9a6';c.fillRect(-2,-5,5,3);c.fillStyle='#6b7451';c.fillRect(0,-4,2,1);break;
      case 'dirt':
        c.fillStyle='#8a8258';c.fillRect(-5,-2,9,3);c.fillStyle='#ad9868';c.fillRect(-3,-3,5,2);break;
      case 'crater':
        c.fillStyle='#416947';c.beginPath();c.ellipse(1,2,18,10,0,0,TAU);c.fill();
        c.fillStyle='#a48e65';c.beginPath();c.ellipse(0,0,14,8,0,0,TAU);c.fill();
        c.fillStyle='#6e6d48';c.beginPath();c.ellipse(0,-1,9,5,0,0,TAU);c.fill();c.fillStyle='#4b5c3c';c.fillRect(-4,-3,8,4);break;
      case 'flower':
        c.fillStyle='#335f40';c.fillRect(-1,-4,2,7);c.fillStyle='#a8bd78';c.fillRect(-4,-1,3,2);c.fillRect(1,-3,3,2);
        c.fillStyle='#e99e74';c.fillRect(-3,-6,6,3);c.fillStyle='#f1d297';c.fillRect(-1,-6,2,2);break;
      case 'fern':
        c.fillStyle='#365f40';c.fillRect(-8,1,17,3);
        for(let i=-3;i<=3;i++){const dx=i*3,dy=-8+Math.abs(i)*2;c.strokeStyle=i%2?'#629852':'#4a8349';c.lineWidth=2;c.beginPath();c.moveTo(0,2);c.lineTo(dx,dy);c.stroke();c.fillStyle='#8fab68';c.fillRect(dx-1,dy,2,2);}
        c.fillStyle='#3f7445';c.fillRect(-1,-4,2,7);break;
      case 'wreck':case 'jeep':
        c.fillStyle='rgba(24,61,35,.30)';c.fillRect(-20,-6,43,23);
        c.fillStyle='#173e36';c.fillRect(-19,-13,39,24);c.fillStyle='#426d5e';c.fillRect(-17,-12,35,21);
        c.fillStyle='#87a278';c.fillRect(-16,-12,31,3);c.fillStyle='#28585c';c.fillRect(-8,-8,15,7);c.fillStyle='#769e91';c.fillRect(-7,-8,12,2);
        c.fillStyle='#263a2f';c.fillRect(-23,-10,5,8);c.fillRect(18,-10,5,8);c.fillRect(-23,3,5,8);c.fillRect(18,3,5,8);
        c.fillStyle='#a76644';c.fillRect(-15,2,8,5);c.fillRect(10,-7,6,6);c.fillStyle='#bd9a62';c.fillRect(-13,-14,4,2);c.fillRect(12,7,5,2);
        c.fillStyle='#ced2a0';c.fillRect(-4,3,8,2);break;
      case 'bones':case 'skull':
        c.fillStyle='#e1d3a9';c.fillRect(-4,-5,7,5);c.fillRect(-2,0,4,2);c.fillStyle='#557052';c.fillRect(-3,-3,2,2);c.fillRect(1,-3,2,2);c.fillStyle='#cbbd8f';c.fillRect(6,1,8,2);break;
      default:
        c.fillStyle='#46774b';c.fillRect(-5,0,11,3);c.fillStyle='#87a66b';c.fillRect(-4,-4,2,5);c.fillRect(1,-5,2,6);c.fillStyle='#6e985c';c.fillRect(5,-2,2,4);
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
    c.fillStyle='#4f7958';c.fillRect(0,0,this.width,this.height);
    c.save();c.setTransform(this.camera.zoom,0,0,this.camera.zoom,this.transform.x,this.transform.y);
    c.fillStyle=this.marginPattern||'#4f7958';c.fillRect(this.bounds.left,this.bounds.top,this.bounds.right-this.bounds.left,this.bounds.bottom-this.bounds.top);
    c.fillStyle='#246d73';c.fillRect(-300,-300,w+600,300);c.fillRect(w,-300,300,h+600);
    const shoreEnd=world.coastline?.at(-1)?.x??w-45;c.fillRect(shoreEnd,h,w-shoreEnd,300);
    c.drawImage(this.cache,0,0);
    this.drawWater(c,time,reducedMotion);
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
  drawWater(c,time,reducedMotion){
    c.save();c.strokeStyle='#d7ebca';c.lineWidth=1.3;c.globalAlpha=.24;
    for(const wave of this.waterMarks||[])if(this.visible(wave.x,wave.y)){
      const drift=reducedMotion?0:Math.sin(time*.75+wave.phase)*1.8;
      const x=wave.x+wave.dy*drift,y=wave.y-wave.dx*drift;
      c.beginPath();c.moveTo(x,y);c.lineTo(x+wave.dx*wave.length,y+wave.dy*wave.length);c.stroke();
    }c.restore();
  }
  drawExtraction(c,ex,time,reducedMotion){
    const active=ex.active,color=ex.regrouping?'#e6c18c':active?'#bee5b6':'#aaa57a';
    c.save();c.translate(ex.x,ex.y);
    c.globalAlpha=active?.12:.035;c.fillStyle=color;c.beginPath();c.arc(0,0,ex.r,0,TAU);c.fill();c.globalAlpha=1;
    c.setLineDash([5,8]);c.beginPath();c.arc(0,0,ex.r,0,TAU);
    if(active){c.strokeStyle='#386647';c.lineWidth=4;c.stroke();}
    c.strokeStyle=ex.regrouping?'#e6c18c':active?'#d6e8b2':'#9caa7a';c.lineWidth=2;c.stroke();c.setLineDash([]);
    c.strokeStyle=ex.regrouping?'#e6c18c':active?'#d9f1b2':'#b7b183';c.lineWidth=2;
    for(let i=0;i<4;i++){const a=i*Math.PI/2,x=Math.cos(a)*(ex.r-14),y=Math.sin(a)*(ex.r-14);c.save();c.translate(x,y);c.rotate(a);c.beginPath();c.moveTo(-8,-6);c.lineTo(-2,0);c.lineTo(-8,6);c.stroke();c.restore();}
    c.fillStyle=active?'#d1efad':'#b8b187';c.fillRect(-10,-2,20,4);c.fillRect(-2,-10,4,20);
    if(active){
      const pulse=reducedMotion?0:Math.sin(time*2.5)*2;c.strokeStyle='#c4d99e';c.lineWidth=1;c.beginPath();c.arc(0,0,15+pulse,0,TAU);c.stroke();
      c.save();const flareScale=clamp(.58/this.camera.zoom,1,1.6);c.scale(flareScale,flareScale);
      c.fillStyle='rgba(220,101,68,.16)';c.beginPath();c.ellipse(2,4,21,12,0,0,TAU);c.fill();
      c.fillStyle='#284e39';c.fillRect(-3,-6,6,11);c.fillStyle='#ba7f50';c.fillRect(-1,-6,2,9);
      const flicker=reducedMotion?1:Math.floor(time*9)%3;
      c.fillStyle='#dc6544';c.fillRect(-4,-16-flicker,8,11+flicker);c.fillRect(-2,-22+flicker,4,8);
      c.fillStyle='#f4c778';c.fillRect(-2,-15-flicker,4,8+flicker);c.fillStyle='#fff0ba';c.fillRect(-1,-12,2,5);
      for(let i=0;i<3;i++){
        const t=reducedMotion?(i+.4)/3:((time*.32+i/3)%1),x=Math.sin(t*4+i)*5,y=-23-t*43,size=4+t*7;
        c.globalAlpha=(1-t)*.22;c.fillStyle='#e1cfab';c.fillRect(Math.round(x-size/2),Math.round(y-size/2),size,size);
      }c.globalAlpha=1;c.restore();
    }
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
    let art=this.obstacleArt?.get(o);
    if(!art){
      const pad=48,canvas=document.createElement('canvas');canvas.width=(o.w||28)+pad*2;canvas.height=(o.h||28)+pad*2;
      const a=canvas.getContext('2d');a.imageSmoothingEnabled=false;a.translate(pad+(o.w||28)/2,pad+(o.h||28)/2);this.paintObstacle(a,o);
      art={canvas,pad};this.obstacleArt?.set(o,art);
    }
    c.drawImage(art.canvas,Math.round(o.x-art.pad),Math.round(o.y-art.pad));
  }
  paintObstacle(c,o) {
    const w=o.w||28,h=o.h||28,variant=Math.floor((o.x+o.y)/31)%3;
    if(o.type==='tree'){
      const crown=-19,rotation=variant*.12;
      // Contact shade and a warm, ringed trunk give the canopy a readable height.
      c.fillStyle='rgba(24,61,35,.25)';c.beginPath();c.ellipse(7,9,22,10,.15,0,TAU);c.fill();
      c.save();c.translate(16,22);c.globalAlpha=.15;
      for(let i=0;i<7;i++){const a=i/7*TAU+.2;c.save();c.rotate(a);c.fillStyle='#183d35';c.fillRect(1,-3,31,6);c.restore();}c.restore();
      c.fillStyle='#6b6b3d';c.fillRect(-3,-17,7,31);c.fillStyle='#bc9e60';c.fillRect(-2,-16,3,28);c.fillStyle='#dec183';c.fillRect(-2,-15,1,26);
      for(let y=-12;y<13;y+=5){c.fillStyle='#857a45';c.fillRect(-3,y,7,2);c.fillStyle='#c6ac6c';c.fillRect(-1,y+1,3,1);}
      c.fillStyle='#3e6340';c.fillRect(-6,11,14,3);c.fillStyle='#91a763';c.fillRect(-5,10,3,2);
      c.save();c.translate(0,crown);c.rotate(rotation);
      for(let i=0;i<7;i++){
        const angle=-Math.PI+.15+i*TAU/7,length=29+(i%3)*5;
        c.save();c.rotate(angle);c.fillStyle='#214f35';
        c.beginPath();c.moveTo(-2,1);c.lineTo(10,-7);c.lineTo(22,-8);c.lineTo(length,-3);c.lineTo(length+1,1);c.lineTo(19,5);c.lineTo(7,7);c.closePath();c.fill();
        c.fillStyle=i<4?'#4b8b49':'#387746';c.beginPath();c.moveTo(0,0);c.lineTo(12,-4);c.lineTo(22,-5);c.lineTo(length,-1);c.lineTo(18,3);c.lineTo(7,4);c.closePath();c.fill();
        c.strokeStyle='#79a35b';c.lineWidth=1.4;c.beginPath();c.moveTo(0,1);c.quadraticCurveTo(18,-2,length,-1);c.stroke();
        c.strokeStyle='#285e39';c.lineWidth=1;for(let x=9;x<length-3;x+=5){c.beginPath();c.moveTo(x,-1);c.lineTo(x-4,-6);c.moveTo(x,0);c.lineTo(x-4,5);c.stroke();}
        c.fillStyle='#a5b46b';c.fillRect(length-4,-2,3,1);c.restore();
      }
      c.fillStyle='#244b32';c.fillRect(-5,-4,11,9);c.fillStyle='#789254';c.fillRect(-4,-5,7,4);c.fillStyle='#b39e60';c.fillRect(1,1,3,4);c.restore();
    }else if(o.type==='hut'){
      const left=-w/2,right=w/2,top=-h/2,front=h/2;
      c.fillStyle='rgba(24,61,35,.25)';c.beginPath();c.moveTo(left+7,top+12);c.lineTo(right+13,top+13);c.lineTo(right+13,front+8);c.lineTo(left+7,front+8);c.closePath();c.fill();
      c.fillStyle='#425d40';c.fillRect(left,top,w,h);
      c.fillStyle='#a68f5e';c.fillRect(left,front-25,w,25);c.fillStyle='#c7aa72';c.fillRect(left,front-25,w,4);
      for(let y=front-17;y<front;y+=6){c.fillStyle='#8e7f51';c.fillRect(left,y,w,1);}
      c.fillStyle='#7b8054';c.fillRect(right-7,front-25,7,25);
      c.fillStyle='#193f36';c.fillRect(left+9,front-19,19,12);c.fillRect(right-29,front-19,19,12);c.fillRect(-8,front-20,16,20);
      c.fillStyle='#75a89a';c.fillRect(left+11,front-17,14,3);c.fillRect(right-27,front-17,14,3);
      c.fillStyle='#d4ba85';c.fillRect(left+8,front-20,21,2);c.fillRect(right-30,front-20,21,2);c.fillRect(-9,front-21,18,2);c.fillRect(6,front-19,2,19);
      c.fillStyle='#daca91';c.fillRect(4,front-10,2,2);c.fillStyle='#dc6544';c.fillRect(right-39,front-15,5,6);
      c.fillStyle='#54704a';c.fillRect(-13,front-1,27,4);c.fillStyle='#b9a275';c.fillRect(-12,front-1,24,2);
      // Two roof planes, corrugation and raised ribs preserve the original cover rectangle.
      c.fillStyle='#3e6144';c.fillRect(left-3,top-5,w+6,h-18);
      c.fillStyle=variant===1?'#a1a06c':'#8d9c6c';c.fillRect(left-2,top-4,w+4,26);
      c.fillStyle=variant===1?'#879366':'#748b60';c.fillRect(left-2,top+22,w+4,h-42);
      for(let x=left+2;x<right;x+=9){
        c.fillStyle='#647c53';c.fillRect(x,top-3,2,h-21);c.fillStyle='#adb580';c.fillRect(x+2,top-3,1,25);
        c.fillStyle='#91a06e';c.fillRect(x+2,top+25,1,h-49);
      }
      c.fillStyle='#c1c28b';c.fillRect(left-3,top-5,w+6,3);c.fillStyle='#b2b782';c.fillRect(left-3,top+20,w+6,3);
      c.fillStyle='#405f40';c.fillRect(left-3,front-20,w+6,4);c.fillStyle='#9ba773';c.fillRect(left-3,front-20,w+6,1);
      c.fillStyle='#435f44';c.fillRect(right-21,top+3,13,9);c.fillStyle='#b5bc84';c.fillRect(right-21,top+3,13,2);c.fillStyle='#6c8b60';c.fillRect(right-19,top+6,9,2);
      c.fillStyle='#bac18c';c.fillRect(left+14,top+6,20,2);c.fillRect(left+47,top+12,13,1);c.fillStyle='#6d8258';c.fillRect(left+32,front-34,17,2);
      c.fillStyle='#e4d6a3';c.fillRect(-6,top+8,12,2);c.fillRect(-1,top+3,2,11);
    }else if(o.type==='barrel'){
      c.fillStyle='rgba(24,61,35,.25)';c.beginPath();c.ellipse(4,9,13,6,0,0,TAU);c.fill();
      c.fillStyle='#705338';c.fillRect(-9,-11,18,23);c.fillStyle='#bd744c';c.fillRect(-8,-10,16,21);
      c.fillStyle='#d69965';c.fillRect(-7,-9,5,19);c.fillStyle='#995c3e';c.fillRect(4,-9,4,19);
      c.fillStyle='#efd0a0';c.beginPath();c.ellipse(0,-10,8,3,0,0,TAU);c.fill();c.fillStyle='#b27d4f';c.fillRect(-3,-11,6,2);
      c.fillStyle='#755e40';c.fillRect(-9,-4,18,2);c.fillRect(-9,6,18,2);c.fillStyle='#e7c892';c.fillRect(-3,-1,7,5);c.fillStyle='#92573c';c.fillRect(-1,0,2,3);
    }else{
      c.fillStyle='rgba(24,61,35,.24)';c.beginPath();c.ellipse(5,8,w*.55,h*.43,0,0,TAU);c.fill();
      c.fillStyle='#627c61';c.beginPath();c.moveTo(-w*.5,h*.18);c.lineTo(-w*.32,-h*.39);c.lineTo(w*.08,-h*.47);c.lineTo(w*.47,-h*.14);c.lineTo(w*.5,h*.34);c.lineTo(0,h*.5);c.closePath();c.fill();
      c.fillStyle='#aab18d';c.beginPath();c.moveTo(-w*.32,-h*.36);c.lineTo(w*.07,-h*.46);c.lineTo(w*.35,-h*.17);c.lineTo(-w*.10,-h*.02);c.closePath();c.fill();
      c.fillStyle='#819f75';c.beginPath();c.moveTo(-w*.10,-h*.02);c.lineTo(w*.35,-h*.17);c.lineTo(w*.48,h*.31);c.lineTo(w*.02,h*.35);c.closePath();c.fill();
      c.strokeStyle='#c2c39a';c.lineWidth=1.5;c.beginPath();c.moveTo(-w*.27,-h*.31);c.lineTo(w*.04,-h*.38);c.stroke();
      c.fillStyle='#386b44';c.fillRect(-w*.3,h*.26,w*.42,3);c.fillRect(w*.28,h*.05,4,h*.25);c.fillStyle='#8ead6d';c.fillRect(-w*.27,h*.24,w*.18,1);
    }
  }
  drawPerson(c,p,type,state,leader) {
    const angle=Number.isFinite(p.angle)?p.angle:-Math.PI/2,zombie=type==='zombie',civilian=type==='civilian',enemy=type==='enemy';
    const time=state.time||0,moving=Boolean(p.moving),phase=Number.isFinite(p.walkPhase)?p.walkPhase:time*(zombie?7:11)+(Number(p.id)||0)*2;
    const step=moving?Math.sin(phase)*2.1:0,bob=moving?Math.abs(Math.sin(phase))*.7:0,hit=(p.hitFlash||0)>0;
    const moveAngle=Number.isFinite(p.moveAngle)?p.moveAngle:angle,footX=Math.cos(moveAngle)*step,footY=Math.sin(moveAngle)*step;
    const dx=Math.cos(angle),dy=Math.sin(angle),faceX=Math.round(dx*1.5),scale=this.personScale||1;
    const skin=p.name==='ROOK'?'#b9865d':p.name==='JUNE'?'#e4c398':'#dcb588';
    c.save();c.translate(Math.round(p.x),Math.round(p.y));c.scale(scale,scale);
    c.fillStyle='rgba(24,61,35,.35)';c.beginPath();c.ellipse(2,5,8,3.5,.08,0,TAU);c.fill();
    if(type==='squad'){
      c.lineWidth=leader?3:1.5;c.strokeStyle=leader?'#194b3c':'#3d8766';c.beginPath();c.ellipse(0,5,leader?10:8,leader?5:4,0,0,TAU);c.stroke();
      if(leader){c.lineWidth=1.2;c.strokeStyle='#e7e0b0';c.beginPath();c.ellipse(0,5,10,5,0,0,TAU);c.stroke();c.fillStyle='#dc6544';c.fillRect(-3,-25,6,2);c.fillRect(-2,-23,4,2);c.fillRect(-1,-21,2,1);}
    }
    if(enemy&&p.reaction>0){c.strokeStyle='#f0b277';c.lineWidth=1;c.beginPath();c.moveTo(0,-29);c.lineTo(3,-25);c.lineTo(0,-21);c.lineTo(-3,-25);c.closePath();c.stroke();}
    c.fillStyle='#203c30';c.fillRect(Math.round(-5+footX),Math.round(3+footY),4,5);c.fillRect(Math.round(2-footX),Math.round(3-footY),4,5);
    c.fillStyle=zombie?'#6c7451':civilian?'#5b775a':'#6a8060';c.fillRect(Math.round(-5+footX),Math.round(3+footY),3,2);c.fillRect(Math.round(2-footX),Math.round(3-footY),3,2);
    c.translate(0,-bob);
    c.fillStyle='#173e36';c.fillRect(-7,-9,14,13);
    c.fillStyle=hit?'#f1e5c4':zombie?'#737c70':civilian?'#d4b67d':enemy?'#bb8a55':'#2e8074';c.fillRect(-5,-8,10,11);
    c.fillStyle=zombie?'#919a7c':civilian?'#f1d69a':enemy?'#deb477':'#72b89a';c.fillRect(-5,-8,3,3);c.fillRect(-5,-5,1,5);
    c.fillStyle=zombie?'#4d6551':civilian?'#9e8d61':enemy?'#765c40':'#286452';c.fillRect(-4,0,8,3);
    if(!zombie&&!civilian){
      c.fillStyle=enemy?'#7b613f':'#b09c6b';c.fillRect(-3,-7,2,9);c.fillRect(2,-7,2,9);c.fillRect(-3,-3,7,2);
      c.fillStyle=enemy?'#dda466':'#d4bf87';c.fillRect(-3,-6,2,3);c.fillRect(2,-6,2,3);
      c.fillStyle=enemy?'#dc6544':'#c8d8a5';c.fillRect(-2,-8,5,2);
      c.fillStyle='#214d3d';c.fillRect(-7,-6,2,7);c.fillStyle='#889d6e';c.fillRect(-6,-5,1,4);
    }
    if(zombie){
      const sway=moving?Math.sin(phase*.5):0;
      c.fillStyle='#20473a';c.fillRect(Math.round(dx*6)-3,Math.round(dy*6)-7+Math.round(sway),5,7);c.fillRect(Math.round(dx*4)-7,Math.round(dy*4)-5-Math.round(sway),4,6);
      c.fillStyle=hit?'#f1e5c4':'#bdcfa8';c.fillRect(Math.round(dx*6)-2,Math.round(dy*6)-6+Math.round(sway),3,5);c.fillRect(Math.round(dx*4)-6,Math.round(dy*4)-4-Math.round(sway),2,4);
      c.fillStyle='#234b3b';c.fillRect(-6+faceX,-18,12,11);c.fillStyle=hit?'#f1e5c4':'#bfcea6';c.fillRect(-5+faceX,-17,10,9);c.fillRect(-3,-9,6,3);
      c.fillStyle='#d8dfb2';c.fillRect(-4+faceX,-16,7,2);c.fillStyle='#648768';c.fillRect(-5+faceX,-16,2,5);
      c.fillStyle='#254b39';c.fillRect(-4+faceX,-13,3,3);c.fillRect(2+faceX,-13,2,3);c.fillRect(-2,-8,4,1);c.fillStyle='#dcaa81';c.fillRect(-1+faceX,-10,2,1);
      c.fillStyle='#835c49';c.fillRect(3,-4,2,4);c.fillStyle='#bfcea6';c.fillRect(-4,2,2,3);c.fillStyle='#455b45';c.fillRect(1,1,2,3);
    }else{
      c.fillStyle='#1c4236';c.fillRect(-5+faceX,-15,10,8);c.fillStyle=hit?'#f1e5c4':civilian?'#e2c692':enemy?'#d9b985':skin;c.fillRect(-4+faceX,-14,8,6);
      c.fillStyle=civilian?'#655034':enemy?'#826240':'#28584b';c.fillRect(-5+faceX,-18,10,6);c.fillRect(-6+faceX,-14,12,2);
      c.fillStyle=civilian?'#a68550':enemy?'#c5a26a':'#769c70';c.fillRect(-4+faceX,-18,7,2);
      if(!civilian){c.fillStyle=enemy?'#e1c486':'#d7d5a1';c.fillRect(-5+faceX,-14,10,1);c.fillStyle=enemy?'#dd724b':'#d9e2b0';c.fillRect(-4+faceX,-16,2,2);}
      c.fillStyle='#294a36';c.fillRect(dx>0?2:-3,-11,2,2);
      if(civilian){
        c.fillStyle='#ebd3a0';c.fillRect(-8,-8,3,6);c.fillRect(5,-8,3,6);
        if(!p.rescued){c.fillStyle='#e6efc2';c.fillRect(-1,-30,2,6);c.fillRect(-1,-22,2,2);}
        else{c.fillStyle='#d6e7ae';c.fillRect(-2,-24,5,2);c.fillRect(1,-26,2,4);}
      }else{
        const recoil=(p.shootFlash||0)>0?1.5:0;c.save();c.translate(0,-4);c.rotate(angle);c.translate(-recoil,0);
        c.fillStyle=enemy?'#d9b985':skin;c.fillRect(3,-2,6,4);c.fillStyle='#193e35';c.fillRect(5,-2,13,3);c.fillStyle='#939d77';c.fillRect(12,-2,6,1);c.fillStyle='#1d352c';c.fillRect(10,0,3,4);
        if(p.shootFlash>0){c.fillStyle='#fff1c4';c.fillRect(19,-2,5,3);c.fillRect(21,-4,2,7);c.fillStyle='#dc8c48';c.fillRect(24,-1,3,2);}
        c.restore();
      }
    }
    if(p.hp!==undefined&&p.maxHp&&(p.hp<p.maxHp||leader)){
      const health=clamp(p.hp/p.maxHp,0,1);c.fillStyle='#183d35';c.fillRect(-8,12,16,3);c.fillStyle=type==='squad'?(health<.30?'#dc6544':'#b9dc9f'):zombie?'#c9d3a0':'#e3b67a';c.fillRect(-7,13,Math.ceil(14*health),1);
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
    c.fillStyle=zombie?'#687662':enemy?'#9b744d':'#286f62';c.fillRect(-6,-3,12,6);
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
