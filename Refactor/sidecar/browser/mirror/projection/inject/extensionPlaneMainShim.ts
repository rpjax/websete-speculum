/**
 * Main-world extension plane shim — injected before virtual.js when loopbackCarrier=extension.
 *
 * CONNECTING sockets ignore premature `error`/`close` from Port/WS churn (superseded
 * attempt) until `open-ok` or `open-fail` — otherwise establish loses the race to open-ok.
 */

import { EXTENSION_PLANE_CHANNEL } from '@speculum/page-projection/core/extensionPlane/envelope';
import { EXTENSION_PLANE_SOCKET_FACTORY_GLOBAL } from '@speculum/page-projection/virtual/transport/extensionPlaneSocket';
import { PROJECTION_CONFIG_GLOBAL } from '@speculum/page-projection/virtual/config/projectionConfig';

const BIND_TIMEOUT_MS = 5_000;

/** Returns IIFE source for CDP inject bundle. */
export function buildExtensionPlaneMainShimJs(): string {
  const channel = EXTENSION_PLANE_CHANNEL;
  const factoryGlobal = EXTENSION_PLANE_SOCKET_FACTORY_GLOBAL;
  const configGlobal = PROJECTION_CONFIG_GLOBAL;

  return `(function speculum_extension_plane_shim() {
'use strict';
var CHANNEL=${JSON.stringify(channel)};
var FACTORY_GLOBAL=${JSON.stringify(factoryGlobal)};
var CONFIG_GLOBAL=${JSON.stringify(configGlobal)};
var BIND_TIMEOUT_MS=${BIND_TIMEOUT_MS};
var RS_CONNECTING=0,RS_OPEN=1,RS_CLOSING=2,RS_CLOSED=3;
var cfg=globalThis[CONFIG_GLOBAL];
if(!cfg||cfg.loopbackCarrier!=='extension')return;
var token=typeof cfg.planeBridgeToken==='string'?cfg.planeBridgeToken:'';
if(!token)return;
var bound=false;
var bindWaiters=[];
var nextSocketId=1;
var sockets=new Map();
function post(msg){
  window.postMessage(Object.assign({channel:CHANNEL,token:token},msg),'*');
}
function stopBindRetry(){
  clearInterval(retry);
  clearTimeout(bindHardStop);
}
function waitBound(){
  if(bound)return Promise.resolve();
  return new Promise(function(resolve,reject){
    var timer=setTimeout(function(){
      stopBindRetry();
      reject(new Error('extension_plane_bind_timeout'));
    },BIND_TIMEOUT_MS);
    bindWaiters.push(function(){
      clearTimeout(timer);
      stopBindRetry();
      resolve();
    });
    post({kind:'bind'});
  });
}
var retry=setInterval(function(){
  if(bound){stopBindRetry();return;}
  post({kind:'bind'});
},100);
var bindHardStop=setTimeout(function(){stopBindRetry();},BIND_TIMEOUT_MS);
window.addEventListener('message',function(ev){
  if(ev.source!==window)return;
  var d=ev.data;
  if(!d||d.channel!==CHANNEL||d.token!==token)return;
  if(d.kind==='bind-ack'){
    bound=true;
    stopBindRetry();
    var waiters=bindWaiters;
    bindWaiters=[];
    for(var i=0;i<waiters.length;i++)waiters[i]();
    return;
  }
  var socket=sockets.get(d.socketId);
  if(!socket)return;
  if(d.kind==='open-ok'){
    socket._readyState=RS_OPEN;
    socket._emit('open',{});
    return;
  }
  if(d.kind==='open-fail'){
    socket._readyState=RS_CLOSED;
    socket._emit('error',{});
    socket._emit('close',{});
    return;
  }
  if(d.kind==='message'&&d.bytes){
    var bytes=d.bytes;
    if(bytes instanceof Uint8Array){
      socket._emit('message',{data:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
    }else if(bytes instanceof ArrayBuffer){
      socket._emit('message',{data:bytes});
    }else if(Array.isArray(bytes)){
      socket._emit('message',{data:Uint8Array.from(bytes).buffer});
    }
    return;
  }
  if(d.kind==='close'){
    if(socket._readyState===RS_CONNECTING)return;
    socket._readyState=RS_CLOSED;
    socket._emit('close',{code:d.code,reason:d.reason});
    return;
  }
  if(d.kind==='error'){
    if(socket._readyState===RS_CONNECTING)return;
    socket._emit('error',{});
  }
});
function createSocket(url){
  var socketId=nextSocketId++;
  var listeners={open:[],message:[],close:[],error:[]};
  var socket={
    _readyState:RS_CONNECTING,
    _bufferedAmount:0,
    binaryType:'arraybuffer',
    get readyState(){return socket._readyState;},
    get bufferedAmount(){return socket._bufferedAmount;},
    send:function(data){
      if(socket._readyState!==RS_OPEN)throw new Error('extension plane socket not open');
      var view;
      if(data instanceof ArrayBuffer)view=new Uint8Array(data);
      else if(ArrayBuffer.isView(data))view=new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
      else throw new Error('invalid send payload');
      post({kind:'send',socketId:socketId,bytes:Array.from(view)});
    },
    close:function(code,reason){
      if(socket._readyState===RS_CLOSED||socket._readyState===RS_CLOSING)return;
      socket._readyState=RS_CLOSING;
      post({kind:'close',socketId:socketId,code:code,reason:reason});
      socket._readyState=RS_CLOSED;
    },
    addEventListener:function(type,fn,opts){
      if(!listeners[type])return;
      listeners[type].push({fn:fn,once:opts&&opts.once});
    },
    removeEventListener:function(type,fn){
      if(!listeners[type])return;
      listeners[type]=listeners[type].filter(function(x){return x.fn!==fn;});
    },
    _emit:function(type,ev){
      var list=listeners[type]||[];
      var copy=list.slice();
      for(var i=0;i<copy.length;i++){
        try{copy[i].fn(ev);}catch(e){}
        if(copy[i].once)listeners[type]=listeners[type].filter(function(x){return x.fn!==copy[i].fn;});
      }
    }
  };
  sockets.set(socketId,socket);
  waitBound().then(function(){
    if(socket._readyState===RS_CLOSED)return;
    post({kind:'open',socketId:socketId,url:url});
  }).catch(function(){
    socket._readyState=RS_CLOSED;
    socket._emit('error',{});
    socket._emit('close',{});
  });
  return socket;
}
globalThis[FACTORY_GLOBAL]=createSocket;
})();`;
}
