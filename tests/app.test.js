import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApplication } from '../server/app.js';
import { metadataFromTags,parseMetadata } from '../server/metadata.js';
import { image,gpsImage } from './fixtures.js';
async function setup(t,options={}){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'photo-checkin-'));
  let app,server;
  async function open(){app=createApplication({dataDir,...options});server=app.app.listen(0,'127.0.0.1');await once(server,'listening');return `http://127.0.0.1:${server.address().port}`;}
  let base=await open();
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));app.close();fs.rmSync(dataDir,{recursive:true,force:true});});
  return {dataDir,get service(){return app;}, async raw(url){return fetch(base+url);}, async restart(){await new Promise(resolve=>server.close(resolve));app.close();base=await open();},async req(url,options={}){const r=await fetch(base+url,options);const raw=await r.text();return {status:r.status,body:raw?JSON.parse(raw):null};},async upload(buffer,name='photo.jpg',mime='image/jpeg'){const form=new FormData();form.append('photo',new Blob([buffer],{type:mime}),name);return this.req('/api/uploads',{method:'POST',body:form});},async save(upload,extra={}){return this.req('/api/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uploadId:upload.id,note:'测试足迹',locationSource:'manual',position:{lng:121.47,lat:31.23,coordinateSystem:'GCJ-02'},...extra})});}};
}
test('真实 EXIF 解析：有效、无效 GPS 和时区保留',async()=>{
  const valid=await parseMetadata(await gpsImage());assert.equal(valid.gpsStatus,'valid');assert.ok(Math.abs(valid.gps.lat-31.225)<1e-8);assert.equal(valid.capturedAt,'2026-09-30T12:34:56+08:00');assert.equal(valid.capturedTimezone,'+08:00');
  const invalid=await parseMetadata(await gpsImage(100));assert.equal(invalid.gps,null);assert.equal(invalid.gpsStatus,'invalid');
  assert.equal((await parseMetadata(await gpsImage(31,false))).capturedAt,'2026-09-30T12:34:56');
  assert.equal((await parseMetadata(await image('png'))).capturedAt,null);
  assert.equal(metadataFromTags({DateTimeOriginal:'2026:02:30 12:00:00'}).capturedAt,null);
});
test('JPEG PNG WebP 类型校验；伪装文件、HEIC、损坏和超限文件拒绝',async t=>{
  const ctx=await setup(t);
  for(const format of ['jpeg','png','webp'])assert.equal((await ctx.upload(await image(format),'任意文件名.exe','application/octet-stream')).status,201);
  assert.equal((await ctx.upload(Buffer.from('<script>evil</script>'),'fake.jpg')).status,415);
  assert.equal((await ctx.upload(Buffer.from('not-a-heic'),'image.heic','image/heic')).status,415);
  assert.equal((await ctx.upload((await image()).subarray(0,30))).status,415);
  const large=await ctx.upload(Buffer.alloc(20*1024*1024+1));assert.equal(large.status,400);assert.match(large.body.error,/20 MB/);
});
test('无 GPS 手动选点、保存幂等、照片持久化、重启读取与删除',async t=>{
  const ctx=await setup(t);const uploaded=(await ctx.upload(await image('png'))).body;assert.equal(uploaded.gps,null);
  const saved=await ctx.save(uploaded);assert.equal(saved.status,201);assert.equal(saved.body.original.coordinateSystem,'GCJ-02');assert.equal(saved.body.position.lng,121.47);assert.equal(saved.body.capturedAt,null);
  const second=await ctx.save(uploaded);assert.equal(second.body.id,saved.body.id);assert.equal((await ctx.req('/api/records')).body.length,1);
  const filename=path.basename(saved.body.photoUrl);assert.ok(fs.existsSync(path.join(ctx.dataDir,'photos',filename)));assert.ok(!fs.existsSync(path.join(ctx.dataDir,'tmp',filename)));
  await ctx.restart();assert.equal((await ctx.req('/api/records')).body[0].id,saved.body.id);
  const deleted=await ctx.req(`/api/records/${saved.body.id}`,{method:'DELETE'});assert.equal(deleted.status,204);assert.deepEqual((await ctx.req('/api/records')).body,[]);assert.ok(!fs.existsSync(path.join(ctx.dataDir,'photos',filename)));assert.equal(fs.readdirSync(path.join(ctx.dataDir,'trash')).length,0);
});
test('含 GPS 自动定位保留原始 WGS84；手动修正不重复转换',async t=>{
  const ctx=await setup(t);const uploaded=(await ctx.upload(await gpsImage())).body;
  const saved=await ctx.save(uploaded,{locationSource:'exif'});assert.equal(saved.body.original.coordinateSystem,'WGS84');assert.equal(saved.body.position.coordinateSystem,'GCJ-02');assert.equal(saved.body.capturedTimezone,'+08:00');assert.equal(saved.body.locationSource,'exif');
  const next=(await ctx.upload(await gpsImage())).body;const manual=await ctx.save(next,{position:{lng:116.4,lat:39.9,coordinateSystem:'GCJ-02'}});assert.equal(manual.body.position.lng,116.4);assert.equal(manual.body.locationSource,'manual');assert.equal(manual.body.original.coordinateSystem,'WGS84');
});
test('位置、来源、备注和路径篡改校验',async t=>{
  const ctx=await setup(t);const upload=(await ctx.upload(await image())).body;
  for(const extra of [{position:{lng:181,lat:0,coordinateSystem:'GCJ-02'}},{position:{lng:'121',lat:31,coordinateSystem:'GCJ-02'}},{position:{lng:121,lat:31,coordinateSystem:'WGS84'}},{locationSource:'exif'},{note:'x'.repeat(201)},{uploadId:'../../outside'}])assert.equal((await ctx.save(upload,extra)).status,400);
  assert.equal((await ctx.req('/api/records',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:'{}'})).status,403);
  assert.equal((await ctx.req('/media/trash/../../outside')).status,404);
});
test('保存与删除数据库失败补偿，输入照片可重试',async t=>{
  const ctx=await setup(t),upload=(await ctx.upload(await image())).body,filename=path.basename(upload.photoUrl);
  ctx.service.db.exec("CREATE TRIGGER fail_save BEFORE INSERT ON records BEGIN SELECT RAISE(ABORT,'test'); END;");
  assert.equal((await ctx.save(upload)).status,500);assert.ok(fs.existsSync(path.join(ctx.dataDir,'tmp',filename)));assert.equal(fs.readdirSync(path.join(ctx.dataDir,'photos')).length,0);
  ctx.service.db.exec('DROP TRIGGER fail_save');const saved=(await ctx.save(upload)).body;
  ctx.service.db.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON records BEGIN SELECT RAISE(ABORT,'test'); END;");
  assert.equal((await ctx.req(`/api/records/${saved.id}`,{method:'DELETE'})).status,500);assert.ok(fs.existsSync(path.join(ctx.dataDir,'photos',filename)));assert.equal((await ctx.req('/api/records')).body.length,1);
  ctx.service.db.exec('DROP TRIGGER fail_delete');assert.equal((await ctx.req(`/api/records/${saved.id}`,{method:'DELETE'})).status,204);
});
test('重启恢复中断的文件移动与过期清理，仅处理应用管理文件',async t=>{
  const ctx=await setup(t);const upload=(await ctx.upload(await image())).body;const file=path.basename(upload.photoUrl);
  fs.renameSync(path.join(ctx.dataDir,'tmp',file),path.join(ctx.dataDir,'photos',file));await ctx.restart();assert.ok(fs.existsSync(path.join(ctx.dataDir,'tmp',file)));
  const saved=(await ctx.save(upload)).body;fs.renameSync(path.join(ctx.dataDir,'photos',file),path.join(ctx.dataDir,'trash',file));await ctx.restart();assert.ok(fs.existsSync(path.join(ctx.dataDir,'photos',file)));assert.equal((await ctx.req('/api/records')).body[0].id,saved.id);
  const expired=(await ctx.upload(await image())).body;ctx.service.db.prepare('UPDATE uploads SET created_at=? WHERE id=?').run('2020-01-01T00:00:00.000Z',expired.id);fs.writeFileSync(path.join(ctx.dataDir,'tmp','keep.txt'),'不属于应用照片');ctx.service.cleanup();assert.ok(!fs.existsSync(path.join(ctx.dataDir,'tmp',path.basename(expired.photoUrl))));assert.ok(fs.existsSync(path.join(ctx.dataDir,'tmp','keep.txt')));
  assert.equal((await ctx.save(expired)).status,410);
});
test('配置缺失不泄漏密钥；代理固定目标，注入服务端安全密钥和网络错误',async t=>{
  const missing=await setup(t);assert.equal((await missing.req('/api/config')).body.amapConfigured,false);assert.equal((await missing.req('/_AMapService/v3/assistant/coordinate/convert')).status,503);
  let url;const configured=await setup(t,{amapKey:'test-key',securityCode:'test-secret',fetchImpl:async input=>{url=input;return new Response(input.searchParams.get('callback') ? `${input.searchParams.get('callback')}({"status":"1"})` : '{"status":"1"}',{headers:{'Content-Type':'application/json'}});}});
  const config=(await configured.req('/api/config')).body;assert.equal(config.amapKey,'test-key');assert.ok(!JSON.stringify(config).includes('test-secret'));
  assert.equal((await configured.req('/_AMapService/v3/assistant/coordinate/convert?key=evil&jscode=evil&locations=121,31')).status,200);assert.equal(url.hostname,'restapi.amap.com');assert.equal(url.searchParams.get('jscode'),'test-secret');assert.equal(url.searchParams.get('key'),'test-key');
  const jsonp=await configured.raw('/_AMapService/v3/test?callback=jsonp_test');assert.match(jsonp.headers.get('content-type'),/application\/javascript/);assert.equal(await jsonp.text(),'jsonp_test({"status":"1"})');assert.equal((await configured.req('/_AMapService/v3/test?callback=alert(1)')).status,400);
  const broken=await setup(t,{amapKey:'key',securityCode:'secret',fetchImpl:async()=>{throw new Error('offline');}});assert.equal((await broken.req('/_AMapService/v3/test')).status,502);
});
