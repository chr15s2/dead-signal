import test from 'node:test';
import assert from 'node:assert/strict';
import {Renderer} from '../dist/renderer.js';
import {GroundLighting} from '../dist/lighting.js';

const objective = () => ({
  type:'holdout', duration:25, held:6, siteIndex:0, siteStarted:true, inside:true,
  sites:[
    {id:'repeater',label:'Village repeater',x:600,y:1200,r:110,duration:12,held:6},
    {id:'mast',label:'Ridge mast',x:1700,y:400,r:105,duration:13,held:0},
  ],
  zone:{x:600,y:1200,r:110},
});
function context(){
  const arcs=[],texts=[];
  return new Proxy({arcs,texts,arc:(...args)=>arcs.push(args),fillText:text=>texts.push(text),measureText:text=>({width:text.length*6})},
    {get:(target,key)=>key in target?target[key]:()=>{}});
}
function view(){
  return {relayObjective:null,relayProps:[],visible:()=>true,worldPixels:value=>value,
    relaysFor:Renderer.prototype.relaysFor,drawRelayGround:Renderer.prototype.drawRelayGround};
}

test('relay equipment remains at both authored sites through handoff and refreshes on a new mission',()=>{
  const renderer=view(),hold=objective();
  const props=renderer.relaysFor(hold);
  assert.deepEqual(props.map(({x,y})=>({x,y})),hold.sites.map(({x,y})=>({x,y})));
  hold.siteIndex=1;hold.sites[0].held=12;hold.zone={x:1700,y:400,r:105};
  assert.equal(renderer.relaysFor(hold),props,'handoff should reuse both props without moving the old repeater');
  const fresh=objective();fresh.sites[0].x=650;
  assert.notEqual(renderer.relaysFor(fresh),props);
  assert.equal(renderer.relayProps[0].x,650);
  assert.equal(props[0].x,600,'a previous mission must not leak its equipment coordinates into the next');
});

test('each relay perimeter measures its local hold and leaves completed equipment quiet',()=>{
  const renderer=view(),hold=objective(),first=context();
  Renderer.prototype.drawObjectiveGround.call(renderer,first,{objective:hold,time:4},true);
  const firstMeter=first.arcs.find(([,,radius])=>radius===103);
  assert.ok(firstMeter);
  assert.equal(firstMeter[4]-firstMeter[3],Math.PI,'6 of 12 site seconds must fill half the ring');
  assert.ok(first.arcs.some(([,,radius])=>radius===35),'upcoming mast has a small muted marker');

  hold.sites[0].held=12;hold.sites[1].held=6;hold.held=18;hold.siteIndex=1;
  hold.zone={x:1700,y:400,r:105};hold.siteStarted=true;
  const second=context();
  Renderer.prototype.drawObjectiveGround.call(renderer,second,{objective:hold,time:17},true);
  assert.equal(second.arcs.filter(([,,radius])=>radius===110).length,0,'completed repeater must lose its active perimeter');
  const secondMeter=second.arcs.find(([,,radius])=>radius===98);
  assert.ok(Math.abs(secondMeter[4]-secondMeter[3]-Math.PI*2*6/13)<1e-12);
});

test('relay handoff bearing immediately targets the ridge mast while old progress stays saved',()=>{
  const hold=objective();hold.siteIndex=1;hold.sites[0].held=12;hold.held=12;
  hold.siteStarted=false;hold.inside=false;hold.zone={x:1700,y:400,r:105};
  const targets=[],renderer={width:390,height:300,transform:{x:0,y:0,zoom:1},
    drawEdgeMarker:(_context,target)=>{targets.push(target);return null;}};
  const state={objective:hold,time:12,enemies:[],soldiers:[],extraction:{x:100,y:100,active:false}};
  Renderer.prototype.drawObjectiveDirection.call(renderer,{},state,{x:600,y:1200});
  assert.deepEqual(targets,[hold.zone]);
  assert.equal(hold.sites[0].held,12);
});

test('rendering both relay props uses shared static art and does not write simulation records',()=>{
  const hold=objective();hold.sites.forEach(Object.freeze);Object.freeze(hold.sites);Object.freeze(hold.zone);Object.freeze(hold);
  const renderer=view();renderer.camera={zoom:.4};renderer.objectiveArt=new Map([['relay-live',{}]]);
  const props=renderer.relaysFor(hold),c=context();
  for(const prop of props)Renderer.prototype.drawObjectiveProp.call(renderer,c,prop,{objective:hold,time:3},true);
  assert.deepEqual(c.texts,['VILLAGE REPEATER','RIDGE MAST']);
  assert.equal(renderer.objectiveArt.size,1,'both locations should reuse one painted receiver sprite');
  assert.equal(hold.held,6);
  assert.equal(hold.sites[1].held,0);
});

test('both relay shadows stay at their equipment through handoff using one cached shadow',()=>{
  const hold=objective(),lighting=new GroundLighting(),art={};
  lighting.equipment.set('holdout',art);
  const draws=[],c={drawImage:(...args)=>draws.push(args)};
  const state={objective:hold,world:{obstacles:[]}};
  lighting.draw(c,state,{visible:()=>true});
  assert.deepEqual(draws,hold.sites.map(site=>[art,site.x-35,site.y-30]));
  hold.siteIndex=1;hold.zone={x:1700,y:400,r:105};hold.sites[0].held=12;
  draws.length=0;
  lighting.draw(c,state,{visible:()=>true});
  assert.deepEqual(draws,hold.sites.map(site=>[art,site.x-35,site.y-30]));
  assert.equal(lighting.equipment.size,1);
});
