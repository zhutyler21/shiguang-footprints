// 浏览器验收专用：使用临时数据和假配置，不访问真实地图服务，不写入用户数据。
import {createApplication} from '../server/app.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'photo-ui-'));
const service=createApplication({dataDir,amapKey:'browser-test-key',securityCode:'browser-test-secret',distDir:path.resolve('dist')});
const server=service.app.listen(3002,'127.0.0.1',()=>console.log('浏览器测试：http://127.0.0.1:3002'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{service.close();fs.rmSync(dataDir,{recursive:true,force:true});process.exit(0);}));
