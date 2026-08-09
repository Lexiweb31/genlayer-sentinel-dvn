import assert from "node:assert/strict";
import test from "node:test";
import {createHeroMotionController} from "../src/hero-motion.js";

function mediaQuery(initial){
  let matches=initial;
  const listeners=new Set();
  return{
    get matches(){return matches},
    addEventListener(type,listener){if(type==="change")listeners.add(listener)},
    removeEventListener(type,listener){if(type==="change")listeners.delete(listener)},
    emit(next){matches=next;for(const listener of listeners)listener({matches:next})},
    listenerCount(){return listeners.size}
  };
}

function video(playResult=Promise.resolve()){
  return{pauseCalls:0,playCalls:0,pause(){this.pauseCalls++},play(){this.playCalls++;return playResult}};
}

test("pauses initially reduced motion and resumes only after a real reduce-to-motion transition",async()=>{
  const preference=mediaQuery(true),element=video();
  const controller=createHeroMotionController({video:element,mediaQuery:preference});
  assert.equal(element.pauseCalls,1);
  assert.equal(element.playCalls,0);
  preference.emit(true);
  assert.equal(element.pauseCalls,1);
  preference.emit(false);
  assert.equal(element.playCalls,1);
  preference.emit(false);
  assert.equal(element.playCalls,1);
  await Promise.resolve();
  controller.dispose();
});

test("does not call play initially and safely catches a rejected transition play",async()=>{
  const preference=mediaQuery(false),element=video(Promise.reject(new Error("autoplay unavailable")));
  const controller=createHeroMotionController({video:element,mediaQuery:preference});
  assert.equal(element.pauseCalls,0);
  assert.equal(element.playCalls,0);
  preference.emit(false);
  assert.equal(element.playCalls,0);
  preference.emit(true);
  assert.equal(element.pauseCalls,1);
  preference.emit(false);
  assert.equal(element.playCalls,1);
  await Promise.resolve();
  controller.dispose();
});

test("removes the preference listener and performs no media work after disposal",()=>{
  const preference=mediaQuery(false),element=video();
  const controller=createHeroMotionController({video:element,mediaQuery:preference});
  assert.equal(preference.listenerCount(),1);
  controller.dispose();
  assert.equal(preference.listenerCount(),0);
  preference.emit(true);preference.emit(false);
  assert.equal(element.pauseCalls,0);
  assert.equal(element.playCalls,0);
});
