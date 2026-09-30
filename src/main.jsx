import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { loadMap, convertGPS } from './map';
import './style.css';
function Icon({name, size=24}) { const paths = {camera:<><path d="M4 7h4l2-3h4l2 3h4v13H4z"/><circle cx="12" cy="13" r="4"/></>,pin:<><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0z"/><circle cx="12" cy="10" r="3"/></>,plus:<path d="M12 5v14M5 12h14"/>,arrow:<path d="M5 12h14m-5-5 5 5-5 5"/>,trash:<><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></>,check:<path d="m5 12 4 4L19 6"/>,close:<path d="m6 6 12 12M6 18 18 6"/>}; return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.pin}</svg>; }
async function api(url,options={}) { const response=await fetch(url,options); if (response.status===204) return null;
  let data; try{data=await response.json();}catch{throw new Error('无法连接本地服务，请确认服务已启动');}
  if (!response.ok) throw new Error(data.error || '操作失败，请重试'); return data; }
const coord = p => p ? `${p.lng.toFixed(6)}, ${p.lat.toFixed(6)}` : '尚未选择位置';
const shotTime = r => r.capturedAt ? r.capturedAt.replace('T',' ') + (r.capturedTimezone ? '' : '（时区未知）') : '未知';
const checkTime = r => new Date(r.checkedInAt).toLocaleString('zh-CN',{hour12:false});
function MapPanel({config,point,records,selected,onPick,onSelect,onReady,busy}) {
  const host=useRef(null),map=useRef(null),callbacks=useRef({onPick,onSelect,onReady,busy});
  callbacks.current={onPick,onSelect,onReady,busy};
  const [status,setStatus]=useState('loading'),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let dead=false,instance,timer;
    callbacks.current.onReady(false);
    if (!config) {setStatus('loading');return;}
    if (!config.amapConfigured) {setStatus('unconfigured');return;}
    setStatus('loading');setError('');
    loadMap(config.amapKey).then(AMap=>{
      if(dead)return;
      instance=new AMap.Map(host.current,{zoom:5,center:[105,35],viewMode:'2D'});map.current=instance;
      timer=setTimeout(()=>{if(!dead){setStatus('error');setError('地图未能加载完成，请检查网络和高德配置');callbacks.current.onReady(false);}},15000);
      instance.on('complete',()=>{if(dead)return;clearTimeout(timer);setStatus('ready');callbacks.current.onReady(true);});
      instance.on('error',()=>{if(dead)return;clearTimeout(timer);setStatus('error');setError('地图服务出错，请检查高德配置后重试');callbacks.current.onReady(false);});
      instance.on('click',e=>{if(callbacks.current.busy)return;callbacks.current.onPick({lng:e.lnglat.getLng(),lat:e.lnglat.getLat(),coordinateSystem:'GCJ-02'});});
    }).catch(e=>{if(!dead){setStatus('error');setError(e.message);}});
    return()=>{dead=true;clearTimeout(timer);instance?.destroy();map.current=null;};
  },[config,attempt]);
  useEffect(()=>{
    if(status!=='ready'||!map.current)return;
    const AMap=window.AMap,m=map.current;const markers=[];
    for(const record of records){const content=document.createElement('button');content.className=`map-pin ${record.id===selected?'active':''}`;content.type='button';content.title=record.note || '查看打卡照片';content.setAttribute('aria-label',content.title);content.textContent='●';
      const marker=new AMap.Marker({position:[record.position.lng,record.position.lat],content,anchor:'bottom-center'});
      marker.on('click',()=>callbacks.current.onSelect(record.id));m.add(marker);markers.push(marker);}
    if(point){const content=document.createElement('span');content.className='draft-pin';content.textContent='＋';const marker=new AMap.Marker({position:[point.lng,point.lat],content,anchor:'bottom-center'});m.add(marker);markers.push(marker);}
    const target=records.find(r=>r.id===selected)?.position || point;
    if(target)m.setZoomAndCenter(14,[target.lng,target.lat]);else if(markers.length)m.setFitView(markers);
    return()=>{m.remove(markers);};
  },[status,records,point,selected]);
  return <section className="panel map-panel"><div className="panel-heading"><span className="step gold">02</span><h2>确认你的足迹</h2><span className="small-label">高德地图</span></div><div className="map-shell"><div ref={host} className="map-canvas" aria-label="打卡位置地图"/>{status!=='ready'&&<div className="map-empty map-overlay"><span className="map-icon"><Icon name="pin" size={36}/></span><h3>{status==='unconfigured'?'地图尚未配置':status==='error'?'地图暂时无法加载':'正在加载地图…'}</h3><p>{status==='unconfigured'?<>在本地 .env 中填写高德 Key 和安全密钥，<br/>重启服务后即可查看地图、选择位置。</>:error || '连接地图后，即可确认照片的位置。'}</p>{status==='unconfigured'?<a className="secondary" href="/api/setup-guide" target="_blank" rel="noreferrer">查看配置步骤</a>:status==='error'?<button className="secondary" onClick={()=>setAttempt(n=>n+1)}>重新加载地图</button>:null}<span className="soft-badge">照片与记录保存在本机</span></div>}</div><div className="map-footer"><i/>{status==='ready'?'点击地图可选点或修正照片位置':'先上传照片，再确认或修正位置'}</div></section>;
}
function App(){
  const [config,setConfig]=useState(null),[draft,setDraft]=useState(null),[point,setPoint]=useState(null),[source,setSource]=useState('manual'),[note,setNote]=useState(''),[confirmed,setConfirmed]=useState(false),[records,setRecords]=useState([]),[selected,setSelected]=useState(null),[busy,setBusy]=useState(''),[notice,setNotice]=useState(null),[mapReady,setMapReady]=useState(false),[convertError,setConvertError]=useState(''),[convertAttempt,setConvertAttempt]=useState(0),[listState,setListState]=useState('loading'),[deleteTarget,setDeleteTarget]=useState(null),[dragging,setDragging]=useState(false);
  const lock=useRef(false),dialog=useRef(null),pickRevision=useRef(0);
  const tell=(text,type='error')=>setNotice({text,type});
  const reload=useCallback(async()=>{setListState('loading');try{const rows=await api('/api/records');setRecords(rows);setListState('ready');}catch(e){setListState('error');tell(e.message);}},[]);
  const loadConfig=useCallback(()=>api('/api/config').then(setConfig).catch(e=>tell(e.message)),[]);
  useEffect(()=>{loadConfig();reload();},[loadConfig,reload]);
  const uploadFile=async file=>{
    if(lock.current || !file)return;
    if(/\.(heic|heif)$/i.test(file.name)){tell('暂不支持 HEIC，请先转换为 JPEG、PNG 或 WebP');return;}
    if(file.size>20*1024*1024){tell('照片超过 20 MB，请压缩后重试');return;}
    lock.current=true;setBusy('upload');setNotice(null);
    try{const form=new FormData();form.append('photo',file);const result=await api('/api/uploads',{method:'POST',body:form});pickRevision.current++;setDraft(result);setPoint(null);setSource(result.gps?'exif':'manual');setConfirmed(false);setNote('');setSelected(null);setConvertError('');
      tell(result.gps?'已读取照片 GPS，正在准备地图位置':result.gpsStatus==='invalid'?'照片 GPS 无效，请在地图手动选点':'照片没有可用 GPS，请在地图手动选点','info');
    }catch(e){tell(e.message);}finally{lock.current=false;setBusy('');}
  };
  useEffect(()=>{
    if(!draft?.gps || !mapReady || source!=='exif' || point)return;
    let dead=false;const revision=pickRevision.current;setConvertError('');
    convertGPS(draft.gps).then(p=>{if(!dead && revision===pickRevision.current){setPoint(p);setConfirmed(false);tell('照片位置已读取，请在地图确认；点击地图可修正','info');}}).catch(e=>{if(!dead)setConvertError(e.message);});return()=>{dead=true;};
  },[draft,mapReady,source,point,convertAttempt]);
  function pick(p){if(!draft || lock.current)return;pickRevision.current++;setPoint(p);setSource('manual');setSelected(null);setConfirmed(false);setConvertError('');setNotice(null);}
  function select(id){setSelected(id);setConfirmed(false);}
  async function save(){if(lock.current||!draft||!point||!confirmed||!mapReady||selected)return;
    lock.current=true;setBusy('save');setNotice(null);
    try{const result=await api('/api/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uploadId:draft.id,note,position:point,locationSource:source})});
      setRecords(rows=>[result,...rows.filter(r=>r.id!==result.id)]);setListState('ready');setSelected(result.id);setDraft(null);setPoint(null);setNote('');setConfirmed(false);tell('已保存，这一刻留在你的足迹里了','success');
    }catch(e){tell(e.message);}finally{lock.current=false;setBusy('');}
  }
  useEffect(()=>{if(deleteTarget)dialog.current?.showModal();},[deleteTarget]);
  function closeDelete(){dialog.current?.close();setDeleteTarget(null);}
  async function remove(){if(!deleteTarget||lock.current)return;lock.current=true;setBusy('delete');
    try{await api(`/api/records/${deleteTarget.id}`,{method:'DELETE'});setRecords(rows=>rows.filter(r=>r.id!==deleteTarget.id));if(selected===deleteTarget.id)setSelected(null);closeDelete();tell('记录及对应照片已删除','success');}catch(e){tell(e.message);closeDelete();}finally{lock.current=false;setBusy('');}
  }
  // Feature-detect the proposed WebMCP API; ordinary browsers use the visible controls.
  const current=useRef({records,select});current.current={records,select};
  useEffect(()=>{
    const context=document.modelContext;if(!context?.registerTool)return;const lifecycle=new AbortController();
    const tools=[{name:'list_photo_checkins',title:'读取照片打卡',description:'读取当前可见的本地打卡记录，不修改记录。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute(input){if(!input||typeof input!=='object'||Object.keys(input).length)throw new Error('参数必须是空对象');return current.current.records.map(r=>({id:r.id,note:r.note,position:r.position,checkedInAt:r.checkedInAt}));}},
      {name:'show_photo_checkin',title:'查看一条足迹',description:'选中现有打卡记录，在界面展示其详情和地图位置；不保存或删除记录。',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},async execute(input){if(!input||typeof input.id!=='string'||Object.keys(input).length!==1||!current.current.records.some(r=>r.id===input.id))throw new Error('记录不存在');current.current.select(input.id);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return {selectedId:input.id};}}];
    for(const tool of tools){try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}}
    return()=>lifecycle.abort();
  },[]);
  const active=records.find(r=>r.id===selected);
  return <main><header><a className="brand" href="/"><span className="brand-icon"><Icon name="pin"/></span>拾光足迹<span className="brand-sub">照片打卡</span></a><span className="local-pill"><i/> 本机保存</span></header><section className="intro"><div><span className="eyebrow">我的照片地图</span><h1>把这一刻，<span>留在地图上。</span></h1><p>上传一张照片，确认它的位置，收藏你的日常足迹。</p></div><div className="stamp"><Icon name="camera" size={30}/><span>每一张，都有故事</span></div></section>
    {notice&&<div className={`notice ${notice.type}`} role={notice.type==='error'?'alert':'status'}><span>{notice.text}</span><button aria-label="关闭提示" onClick={()=>setNotice(null)}><Icon name="close" size={18}/></button></div>}
    <div className="workspace"><section className="panel upload-panel"><div className="panel-heading"><span className="step">01</span><h2>留下一个瞬间</h2>{draft&&<span className="small-label">可点击更换</span>}</div><label className={`dropzone ${dragging?'dragging':''}`} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);if(e.dataTransfer.files.length!==1){tell('请每次上传一张照片');return;}uploadFile(e.dataTransfer.files[0]);}}>
      {draft?<img src={draft.photoUrl} alt="待打卡照片"/>:<><span className="upload-icon"><Icon name="plus" size={32}/></span><strong>{busy==='upload'?'正在读取照片…':'点击选择，或拖入照片'}</strong><span>JPEG、PNG、WebP · 单张最大 20 MB</span></>}
      <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="选择打卡照片" disabled={!!busy} onChange={e=>{uploadFile(e.target.files[0]);e.target.value='';}}/>{busy==='upload'&&draft&&<span className="uploading">正在读取新照片…</span>}</label>
      <p className="hint">{draft?`拍摄时间：${shotTime(draft)}`:'含定位信息的照片，会自动读取拍摄位置。'}</p>
      {draft&&<div className="location-box"><div><span className={`source ${source==='exif'?'automatic':''}`}>{source==='exif'?'照片自动定位':'手动定位'}</span><span className="coordinate">{coord(point)}</span></div>{convertError?<><p role="alert">{convertError}</p><button className="text-button" onClick={()=>setConvertAttempt(n=>n+1)}>重试自动定位</button></>:<p>{point?'在地图检查位置，点击其他地方可修正。':mapReady?(draft.gps?'正在转换照片位置…':'点击地图选择这张照片的位置。'):'地图可用后才能选择与确认位置。'}</p>}
        {selected&&<button className="text-button" onClick={()=>setSelected(null)}>返回当前照片位置</button>}{point&&<label className="confirm"><input type="checkbox" checked={confirmed} disabled={!!busy||!mapReady||!!selected} onChange={e=>setConfirmed(e.target.checked)}/>我已确认地图上的位置</label>}</div>}
      <label className="note-label">一句话记录<span>{note.length}/200</span><textarea value={note} disabled={!!busy} onChange={e=>setNote(e.target.value)} placeholder="今天看见了什么？" maxLength={200}/></label>
      <button className="primary" disabled={!draft||!point||!confirmed||!mapReady||!!busy||!!selected} onClick={save}>{busy==='save'?'正在保存…':confirmed?'保存这次打卡':'确认位置后保存'}<Icon name="arrow" size={20}/></button></section>
      <MapPanel config={config} point={point} records={records} selected={selected} onPick={pick} onSelect={select} onReady={setMapReady} busy={!!busy}/></div>
    {!config&&<button className="text-button" onClick={loadConfig}>重试连接本地服务</button>}
    <section className="history"><div className="history-title"><h2>我的足迹 <span>{records.length}</span></h2><span>按打卡时间排列</span></div>
      {listState==='error'?<div className="history-empty"><strong>历史记录读取失败</strong><button className="secondary" onClick={reload}>重新读取</button></div>:listState==='loading'?<div className="history-empty" role="status">正在读取本地足迹…</div>:!records.length?<div className="history-empty"><Icon name="camera" size={32}/><strong>第一段故事，从一张照片开始</strong><p>保存后的照片和位置会出现在这里。</p></div>:<><div className="history-grid">{records.map(r=><article className={`history-card ${r.id===selected?'selected':''}`} key={r.id}><button className="record-open" onClick={()=>select(r.id)} aria-label={`查看足迹：${r.note||checkTime(r)}`}><img src={r.photoUrl} alt={r.note||'已保存的打卡照片'} loading="lazy"/><div className="record-text"><span className="source">{r.locationSource==='exif'?'照片自动定位':'手动定位'}</span><h3>{r.note||'未填写备注'}</h3><p><Icon name="pin" size={14}/>{coord(r.position)}</p><time>打卡 {checkTime(r)}</time></div></button><button className="delete-button" aria-label={`删除足迹：${r.note||checkTime(r)}`} disabled={!!busy} onClick={()=>setDeleteTarget(r)}><Icon name="trash" size={17}/></button></article>)}</div>
      {active&&<div className="detail-panel"><img src={active.photoUrl} alt={active.note||'足迹照片详情'}/><div><span className="eyebrow">这一刻的足迹</span><h3>{active.note||'未填写备注'}</h3><dl><dt>定位来源</dt><dd>{active.locationSource==='exif'?'照片自动定位':'手动定位'}</dd><dt>拍摄时间</dt><dd>{shotTime(active)}</dd><dt>打卡时间</dt><dd>{checkTime(active)}</dd><dt>地图位置</dt><dd>{coord(active.position)} · GCJ-02</dd><dt>原始坐标</dt><dd>{coord(active.original)} · {active.original.coordinateSystem}</dd></dl></div><button className="detail-close" aria-label="关闭足迹详情" onClick={()=>setSelected(null)}><Icon name="close" size={20}/></button></div>}</>}
    </section><footer>拾光足迹 <span>把平凡的日子，走成自己的地图。</span></footer>
    <dialog ref={dialog} className="delete-dialog" aria-labelledby="delete-title" onCancel={e=>{if(busy){e.preventDefault();return;}setDeleteTarget(null);}}><span className="delete-symbol"><Icon name="trash" size={28}/></span><h2 id="delete-title">删除这段足迹？</h2><p>这条记录和对应照片会从本机删除，无法撤销。</p><div><button className="secondary" disabled={!!busy} onClick={closeDelete}>保留足迹</button><button className="danger" disabled={!!busy} onClick={remove}>{busy==='delete'?'正在删除…':'删除记录和照片'}</button></div></dialog>
    </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
