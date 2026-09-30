// 仅用于浏览器交互验收的高德替身；不代表真实地图加载或坐标转换已验证。
(() => {
  window.__mapTest={converted:[],failConversion:false};
  class FakeMap {
    constructor(host){this.host=host;this.handlers={};this.host.style.background='#e7efdf';const label=document.createElement('span');label.textContent='测试地图（高德替身）';label.style.cssText='position:absolute;top:40%;left:25%;color:#64775a;font-size:16px';this.host.append(label);this.host.addEventListener('click',this.listener=e=>{if(e.target.tagName==='BUTTON')return;this.handlers.click?.({lnglat:{getLng:()=>116.4,getLat:()=>39.9}});});}
    on(name,fn){this.handlers[name]=fn;if(name==='complete')setTimeout(fn,40);}
    add(marker){this.host.append(marker.content);marker.content.style.position='absolute';marker.content.style.left=(30+Math.random()*40)+'%';marker.content.style.top='55%';}
    remove(markers){markers.forEach(marker=>marker.content.remove());}
    setZoomAndCenter(zoom,center){window.__mapTest.center=center;}
    setFitView(){}
    destroy(){this.host.removeEventListener('click',this.listener);this.host.replaceChildren();}
  }
  class Marker{constructor(options){this.content=options.content;this.position=options.position;}on(name,fn){this.content.addEventListener(name,e=>{e.stopPropagation();fn();});}}
  window.AMap={Map:FakeMap,Marker,convertFrom(gps,type,cb){window.__mapTest.converted.push({gps,type});if(window.__mapTest.failConversion){setTimeout(()=>cb('error',{}),20);return;}setTimeout(()=>cb('complete',{info:'ok',locations:[{getLng:()=>gps[0]+.004,getLat:()=>gps[1]-.002}]}),20);}};
})();
