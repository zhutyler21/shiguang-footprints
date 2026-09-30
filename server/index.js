import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApplication } from './app.js';
const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const service = createApplication({ dataDir: path.resolve(projectDir,process.env.DATA_DIR || 'data'), amapKey:process.env.AMAP_KEY,securityCode:process.env.AMAP_SECURITY_CODE,distDir:path.join(projectDir,'dist') });
const port = Number(process.env.PORT || 3001);
const server = service.app.listen(port,'127.0.0.1',error => {
  if (error) { console.error('服务启动失败：',error.code);service.close();process.exitCode=1;return; }
  console.log(`拾光足迹本地服务：http://127.0.0.1:${port}`);
  if (!process.env.AMAP_KEY || !process.env.AMAP_SECURITY_CODE) console.log('地图未配置：在 .env 填写 AMAP_KEY 与 AMAP_SECURITY_CODE 后重启。');
});
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>{service.close();process.exit(0);}));
