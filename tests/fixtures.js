import sharp from 'sharp';
export async function image(format='jpeg'){return sharp({create:{width:64,height:48,channels:3,background:{r:219,g:167,b:100}}}).toFormat(format).toBuffer();}
export async function gpsImage(latitude=31,withOffset=true){
  const jpeg=await image();
  const tiff=Buffer.alloc(220);tiff.write('II',0);tiff.writeUInt16LE(42,2);tiff.writeUInt32LE(8,4);
  const entry=(at,tag,type,count,value)=>{tiff.writeUInt16LE(tag,at);tiff.writeUInt16LE(type,at+2);tiff.writeUInt32LE(count,at+4);if(typeof value==='string')tiff.write(value,at+8,'ascii');else tiff.writeUInt32LE(value,at+8);};
  tiff.writeUInt16LE(2,8);entry(10,0x8769,4,1,38);entry(22,0x8825,4,1,68);
  tiff.writeUInt16LE(withOffset?2:1,38);entry(40,0x9003,2,20,122);if(withOffset)entry(52,0x9011,2,7,142);
  tiff.writeUInt16LE(4,68);entry(70,1,2,2,'N\0');entry(82,2,5,3,150);entry(94,3,2,2,'E\0');entry(106,4,5,3,174);
  tiff.write('2026:09:30 12:34:56\0',122,'ascii');tiff.write('+08:00\0',142,'ascii');
  for(const [at,values] of [[150,[latitude,13,30]],[174,[121,28,0]]])values.forEach((n,i)=>{tiff.writeUInt32LE(n,at+i*8);tiff.writeUInt32LE(1,at+i*8+4);});
  const exif=Buffer.concat([Buffer.from('Exif\0\0'),tiff]);const marker=Buffer.alloc(4);marker.writeUInt16BE(0xffe1);marker.writeUInt16BE(exif.length+2,2);
  return Buffer.concat([jpeg.subarray(0,2),marker,exif,jpeg.subarray(2)]);
}
