import { fail } from './domain.mjs';
export function decodePhoto(photo) {
  if (!photo || !['image/jpeg','image/png'].includes(photo.type) || typeof photo.data!=='string' || photo.data.length>700000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(photo.data)) fail(400,'JPEG 또는 PNG 사진을 선택해 주세요.');
  let bytes;try{bytes=Uint8Array.from(atob(photo.data),c=>c.charCodeAt(0));}catch{fail(400,'사진을 읽을 수 없습니다.');}
  if(bytes.length>512*1024)fail(413,'변환된 사진은 512KB 이하여야 합니다.');
  const jpeg=bytes.length>=4 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255 && bytes.at(-2)===255 && bytes.at(-1)===217;
  const png=[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
  if(photo.type==='image/jpeg'?!jpeg:!png)fail(400,'사진 형식과 내용이 일치하지 않습니다.');
  return {bytes,type:photo.type};
}
export const photoKeys = (room,userId) => room.seasons.flatMap(s=>s.records.filter(r=>r.photoId && (!userId || r.userId===userId)).map(r=>room.id+'/'+r.photoId));
