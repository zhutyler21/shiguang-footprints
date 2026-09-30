let loading;
export function loadMap(key) {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (loading) return loading;
  loading = new Promise((resolve,reject) => {
    window._AMapSecurityConfig = { serviceHost: `${window.location.origin}/_AMapService` };
    const script = document.createElement('script');
    const timer = setTimeout(() => done(new Error('地图加载超时，请检查网络、Key 和安全密钥')),15000);
    function done(error) { clearTimeout(timer);script.onerror=null;script.onload=null;
      if (error) {script.remove(); loading=undefined;reject(error);} else resolve(window.AMap); }
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;
    script.onerror = () => done(new Error('地图加载失败，请检查网络及高德配置'));
    script.onload = () => done(window.AMap ? null : new Error('高德地图未能初始化，请检查 Key 是否为 Web 端 JS API 类型'));
    document.head.appendChild(script);
  });
  return loading;
}
export function convertGPS(gps) {
  return new Promise((resolve,reject) => {
    const timer = setTimeout(()=>reject(new Error('照片坐标转换超时，可重试或在地图手动选点')),12000);
    window.AMap.convertFrom([gps.lng,gps.lat],'gps',(status,result) => {
      clearTimeout(timer);
      if (status !== 'complete' || !result.locations?.length) return reject(new Error('照片坐标转换失败，可重试或在地图手动选点'));
      const point = result.locations[0];
      resolve({lng:point.getLng(),lat:point.getLat(),coordinateSystem:'GCJ-02'});
    });
  });
}
