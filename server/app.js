import express from 'express';
import multer from 'multer';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseMetadata, validPoint } from './metadata.js';
const ID = /^[a-f0-9-]{36}$/;
const PHOTO = /^[a-f0-9-]{36}\.(jpg|png|webp)$/;
function fail(status, message) { return Object.assign(new Error(message), { status }); }
export function createApplication({ dataDir, amapKey = '', securityCode = '', distDir, fetchImpl = fetch }) {
  const root = path.resolve(dataDir);
  for (const folder of [root, ...['tmp','photos','trash'].map(n => path.join(root,n))]) {
    fs.mkdirSync(folder, { recursive: true });
    if (fs.lstatSync(folder).isSymbolicLink()) throw new Error('数据目录不能使用符号链接');
  }
  const dbPath = path.join(root,'checkins.sqlite');
  if (fs.existsSync(dbPath) && fs.lstatSync(dbPath).isSymbolicLink()) throw new Error('数据库不能使用符号链接');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, filename TEXT NOT NULL, metadata TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, upload_id TEXT UNIQUE NOT NULL, filename TEXT NOT NULL, note TEXT NOT NULL,
    original_lng REAL NOT NULL, original_lat REAL NOT NULL, original_system TEXT NOT NULL, map_lng REAL NOT NULL, map_lat REAL NOT NULL,
    location_source TEXT NOT NULL, captured_at TEXT, captured_timezone TEXT, captured_at_raw TEXT, checked_in_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS records_time ON records(checked_in_at DESC); PRAGMA user_version=1;`);
  function managedFile(folder, filename) { if (!PHOTO.test(filename)) throw fail(400,'无效照片标识'); const target = path.join(root, folder, filename); if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw fail(400,'无效照片路径'); return target; }
  function reconcile() {
    for (const filename of fs.readdirSync(path.join(root,'trash'))) { if (!PHOTO.test(filename)) continue; const source = managedFile('trash',filename); if (db.prepare('SELECT id FROM records WHERE filename=?').get(filename)) fs.renameSync(source,managedFile('photos',filename)); else fs.unlinkSync(source); }
    for (const filename of fs.readdirSync(path.join(root,'photos'))) { if (!PHOTO.test(filename)) continue; if (db.prepare('SELECT id FROM records WHERE filename=?').get(filename)) continue; const source = managedFile('photos',filename); if (db.prepare('SELECT id FROM uploads WHERE filename=?').get(filename)) fs.renameSync(source,managedFile('tmp',filename)); else fs.unlinkSync(source); }
  }
  function cleanup() {
    const cutoff = new Date(Date.now()-24*60*60*1000).toISOString();
    for (const row of db.prepare('SELECT * FROM uploads WHERE created_at < ?').all(cutoff)) {
      const file = managedFile('tmp',row.filename); if (fs.existsSync(file)) fs.unlinkSync(file);
      db.prepare('DELETE FROM uploads WHERE id=?').run(row.id);
    }
    for (const filename of fs.readdirSync(path.join(root,'tmp'))) {
      if (!PHOTO.test(filename)) continue;
      const file = managedFile('tmp',filename);
      if (!db.prepare('SELECT id FROM uploads WHERE filename=?').get(filename) && fs.statSync(file).mtimeMs < Date.now()-86400000) fs.unlinkSync(file);
    }
  }
  reconcile(); cleanup();
  const timer = setInterval(() => { try { cleanup(); } catch { console.error('临时照片清理失败，将在下一轮重试'); } }, 3600000); timer.unref();
  const app = express(); app.disable('x-powered-by');
  // Local-only API: reject unexpected Hosts and cross-origin writes.
  app.use((req,res,next) => {
    const host = (req.headers.host || '').split(':')[0];
    if (!['127.0.0.1','localhost'].includes(host)) return next(fail(403,'仅允许本机访问'));
    if (req.headers.origin) { let origin; try { origin = new URL(req.headers.origin); } catch { return next(fail(403,'请求来源无效')); }
      const allowedPorts = new Set(['5173',String(process.env.PORT || 3001),String(req.socket.localPort)]);
      if (!['127.0.0.1','localhost'].includes(origin.hostname) || !allowedPorts.has(origin.port) || origin.protocol !== 'http:') return next(fail(403,'不允许跨来源访问')); }
    res.setHeader('X-Content-Type-Options','nosniff'); next();
  });
  app.use(express.json({ limit:'16kb' }));
  function serialize(row) { return { id: row.id, photoUrl: `/media/photos/${row.filename}`, note: row.note,
    original: { lng:row.original_lng,lat:row.original_lat,coordinateSystem:row.original_system },
    position:{ lng:row.map_lng,lat:row.map_lat,coordinateSystem:'GCJ-02' }, locationSource:row.location_source,
    capturedAt:row.captured_at,capturedTimezone:row.captured_timezone,capturedAtRaw:row.captured_at_raw, checkedInAt:row.checked_in_at }; }
  app.use('/api', (req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
  app.get('/api/setup-guide',(req,res)=>res.sendFile(path.resolve('public/setup.html')));
  app.get('/api/config',(req,res) => res.json({ amapConfigured:!!(amapKey && securityCode), amapKey: securityCode ? amapKey : '', maxFileSize:20*1024*1024 }));
  app.get('/api/health',(req,res) => res.json({ ok:true }));
  const upload = multer({ storage:multer.memoryStorage(), limits:{ fileSize:20*1024*1024,files:1,fields:0,parts:1 } });
  app.post('/api/uploads',upload.single('photo'),async(req,res) => {
    if (!req.file) throw fail(400,'请选择一张照片');
    const buffer = req.file.buffer;
    let image;
    try { image = await sharp(buffer,{limitInputPixels:80000000}).metadata(); } catch { throw fail(415,'无法读取照片，请上传有效的 JPEG、PNG 或 WebP；HEIC 请先转换格式'); }
    if (!['jpeg','png','webp'].includes(image.format)) throw fail(415,'仅支持 JPEG、PNG、WebP；HEIC 请先转换格式');
    if (image.pages > 1) throw fail(415,'请上传静态照片，暂不支持动画图片');
    try { await sharp(buffer,{limitInputPixels:80000000}).stats(); } catch { throw fail(415,'照片已损坏或像素过大，请换一张照片'); }
    const metadata = await parseMetadata(buffer);
    const id = randomUUID(), filename = `${id}.${image.format === 'jpeg' ? 'jpg' : image.format}`;
    const file = managedFile('tmp',filename);
    fs.writeFileSync(file,buffer,{flag:'wx'});
    try { db.prepare('INSERT INTO uploads VALUES (?,?,?,?)').run(id,filename,JSON.stringify(metadata),new Date().toISOString()); }
    catch (error) { fs.unlinkSync(file); throw error; }
    res.status(201).json({ id, photoUrl:`/media/tmp/${filename}`, ...metadata });
  });
  app.get('/api/records',(req,res) => res.json(db.prepare('SELECT * FROM records ORDER BY checked_in_at DESC,id DESC').all().map(serialize)));
  app.post('/api/records',(req,res) => {
    const { uploadId, note = '', position, locationSource } = req.body || {};
    if (typeof uploadId !== 'string' || !ID.test(uploadId)) throw fail(400,'照片标识无效');
    const previous = db.prepare('SELECT * FROM records WHERE upload_id=?').get(uploadId);
    if (previous) return res.json(serialize(previous));
    if (typeof note !== 'string' || note.length > 200) throw fail(400,'备注不得超过 200 字');
    if (!position || !validPoint(position.lng,position.lat) || position.coordinateSystem !== 'GCJ-02') throw fail(400,'请确认有效的高德地图位置');
    if (!['exif','manual'].includes(locationSource)) throw fail(400,'定位来源无效');
    const pending = db.prepare('SELECT * FROM uploads WHERE id=?').get(uploadId);
    if (!pending || pending.created_at < new Date(Date.now()-86400000).toISOString()) throw fail(410,'临时照片已过期，请重新上传');
    const metadata = JSON.parse(pending.metadata);
    if (locationSource === 'exif' && !metadata.gps) throw fail(400,'照片没有有效 GPS，请手动选点');
    const original = metadata.gps || { ...position, coordinateSystem:'GCJ-02' };
    const row = { id:randomUUID(),upload_id:uploadId,filename:pending.filename,note:note.trim(),original_lng:original.lng,original_lat:original.lat,
      original_system:original.coordinateSystem,map_lng:position.lng,map_lat:position.lat,location_source:locationSource,
      captured_at:metadata.capturedAt,captured_timezone:metadata.capturedTimezone,captured_at_raw:metadata.capturedAtRaw,checked_in_at:new Date().toISOString() };
    const from = managedFile('tmp',pending.filename), to = managedFile('photos',pending.filename);
    let moved = false;
    try { db.transaction(() => { fs.renameSync(from,to); moved = true;
      db.prepare(`INSERT INTO records VALUES (@id,@upload_id,@filename,@note,@original_lng,@original_lat,@original_system,@map_lng,@map_lat,@location_source,@captured_at,@captured_timezone,@captured_at_raw,@checked_in_at)`).run(row);
      db.prepare('DELETE FROM uploads WHERE id=?').run(uploadId);
    })(); } catch (error) { if (moved) fs.renameSync(to,from); throw error; }
    res.status(201).json(serialize(row));
  });
  app.delete('/api/records/:id',(req,res) => {
    if (!ID.test(req.params.id)) throw fail(400,'记录标识无效');
    const row = db.prepare('SELECT * FROM records WHERE id=?').get(req.params.id);
    if (!row) return res.status(204).end();
    const from = managedFile('photos',row.filename), to = managedFile('trash',row.filename);
    let moved = false;
    try { db.transaction(() => { if (fs.existsSync(from)) {fs.renameSync(from,to); moved = true;} db.prepare('DELETE FROM records WHERE id=?').run(row.id); })(); }
    catch (error) { if (moved) fs.renameSync(to,from); throw error; }
    if (moved) { try { fs.unlinkSync(to); } catch { console.error('删除照片将在下次启动时清理'); } }
    res.status(204).end();
  });
  app.get('/media/:folder/:filename',(req,res,next) => {
    try { if (!['tmp','photos'].includes(req.params.folder)) throw fail(404,'照片不存在');
      const file = managedFile(req.params.folder,req.params.filename);
      const table = req.params.folder === 'tmp' ? 'uploads' : 'records';
      if (!db.prepare(`SELECT id FROM ${table} WHERE filename=?`).get(req.params.filename)) throw fail(404,'照片不存在');
      res.setHeader('Cache-Control','no-store'); res.sendFile(file,err => { if(err) next(fail(404,'照片不存在')); });
    } catch(error){next(error);} });
  app.get('/_AMapService/*path',async(req,res) => {
    if (!amapKey || !securityCode) throw fail(503,'高德地图尚未配置');
    const suffix = req.path.slice('/_AMapService'.length);
    if (!/^\/v[34]\/[a-zA-Z0-9/_-]+$/.test(suffix)) throw fail(400,'无效地图请求');
    const upstream = new URL(suffix, suffix.startsWith('/v4/map/styles') ? 'https://webapi.amap.com' : 'https://restapi.amap.com');
    for (const [key,value] of new URLSearchParams(req.url.split('?')[1] || '')) if (!['jscode','key'].includes(key)) upstream.searchParams.append(key,value);
    upstream.searchParams.set('key',amapKey); upstream.searchParams.set('jscode',securityCode);
    const callback = upstream.searchParams.get('callback');
    if (callback && !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(callback)) throw fail(400,'无效地图回调');
    try { const response = await fetchImpl(upstream,{signal:AbortSignal.timeout(12000),redirect:'error'});
      res.status(response.status).type(callback ? 'application/javascript' : response.headers.get('content-type') || 'application/json').send(Buffer.from(await response.arrayBuffer()));
    } catch { throw fail(502,'地图服务连接失败，请检查网络或稍后重试'); }
  });
  app.use('/api',(req,res,next)=>next(fail(404,'接口不存在')));
  if (distDir && fs.existsSync(distDir)) app.use(express.static(distDir));
  app.use((req,res,next)=>next(fail(404,'页面不存在')));
  app.use((error,req,res,next) => { if (res.headersSent) return next(error);
    let status=error.status || 500, message=error.status ? error.message : '操作失败，请重试；当前输入仍保留';
    if (error instanceof multer.MulterError) { status=400; message=error.code==='LIMIT_FILE_SIZE' ? '照片超过 20 MB，请压缩后重试' : '请只上传一张照片'; }
    if (error.type === 'entity.parse.failed') { status=400; message='请求数据无效'; }
    if (status===500) console.error('操作失败：',error.code || error.name);
    res.status(status).json({error:message});
  });
  return { app, db, cleanup, close(){clearInterval(timer);db.close();} };
}
