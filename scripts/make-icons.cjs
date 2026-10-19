const fs = require('node:fs');
const path = require('node:path');
const size = 256;
const scale = 4;
const pixels = Buffer.alloc(size * size * 4);
const mix = (a, b, t) => Math.round(a + (b - a) * t);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const lx=x/scale,ly=y/scale; const px = lx - 31.5, py = ly - 31.5;
  const inside = Math.hypot(Math.max(Math.abs(px) - 23, 0), Math.max(Math.abs(py) - 23, 0)) <= 8;
  let color = inside ? [mix(111, 85, lx / 63), mix(126, 94, ly / 63), 235, 255] : [0,0,0,0];
  const inBox = lx >= 14 && lx <= 49 && ly >= 15 && ly <= 49;
  if (inBox && ((ly >= 15 && ly <= 21) || (lx >= 18 && lx <= 45 && ly >= 25 && ly <= 26) || (lx >= 18 && lx <= 43 && ly >= 32 && ly <= 33) || (lx >= 18 && lx <= 38 && ly >= 39 && ly <= 40))) color = [255,255,255,255];
  if (inBox && ((Math.round(lx) === 22 || Math.round(lx) === 41) && ly >= 12 && ly <= 19)) color = [238,240,255,255];
  const i = ((size - 1 - y) * size + x) * 4; pixels[i] = color[2]; pixels[i+1] = color[1]; pixels[i+2] = color[0]; pixels[i+3] = color[3];
}
const header = Buffer.alloc(40); header.writeUInt32LE(40,0); header.writeInt32LE(size,4); header.writeInt32LE(size*2,8); header.writeUInt16LE(1,12); header.writeUInt16LE(32,14); header.writeUInt32LE(0,16); header.writeUInt32LE(pixels.length,20);
const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size);
const image = Buffer.concat([header,pixels,mask]); const icoHeader=Buffer.alloc(6);icoHeader.writeUInt16LE(0,0);icoHeader.writeUInt16LE(1,2);icoHeader.writeUInt16LE(1,4);
const entry=Buffer.alloc(16);entry.writeUInt8(size===256?0:size,0);entry.writeUInt8(size===256?0:size,1);entry.writeUInt8(0,2);entry.writeUInt8(0,3);entry.writeUInt16LE(1,4);entry.writeUInt16LE(32,6);entry.writeUInt32LE(image.length,8);entry.writeUInt32LE(22,12);
const root=path.resolve(__dirname,'..');const assets=path.join(root,'assets');fs.mkdirSync(assets,{recursive:true});fs.writeFileSync(path.join(assets,'app.ico'),Buffer.concat([icoHeader,entry,image]));
const raw=path.join(root,'android','app','src','main','res','raw');if(fs.existsSync(path.join(root,'android'))){fs.mkdirSync(raw,{recursive:true});const rate=22050,seconds=.34,count=Math.floor(rate*seconds),wav=Buffer.alloc(44+count*2);wav.write('RIFF',0);wav.writeUInt32LE(36+count*2,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(count*2,40);for(let i=0;i<count;i++){const t=i/rate;const envelope=Math.min(1,t*40)*Math.max(0,1-t/seconds);wav.writeInt16LE(Math.round(Math.sin(2*Math.PI*(660-220*t/seconds)*t)*envelope*4500),44+i*2);}fs.writeFileSync(path.join(raw,'reminder.wav'),wav);}
console.log('Created assets/app.ico and Android reminder tone when the Android project exists.');
