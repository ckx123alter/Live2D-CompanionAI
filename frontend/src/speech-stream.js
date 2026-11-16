export function audioBytes(encoded) {
  if(typeof encoded!=='string'||encoded.length>15*1024*1024)throw new Error('语音数据无效。');
  const binary=atob(encoded),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}

export async function* speechEvents(response) {
  if(!response.body)throw new Error('浏览器无法读取语音流。');
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let pending='',total=0,complete=false;
  try {
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>16*1024*1024)throw new Error('语音响应过大。');
      pending+=decoder.decode(value,{stream:true});
      let split;
      while((split=pending.indexOf('\n'))>=0){
        const line=pending.slice(0,split);pending=pending.slice(split+1);
        if(!line.trim())continue;
        const event=JSON.parse(line);
        if(event.type==='error')throw Object.assign(new Error(typeof event.detail==='string'?event.detail:'服务端语音处理失败，请稍后点击朗读重试。'),{code:event.code||'speech_processing_failed'});
        if(event.type==='done'||event.type==='empty')complete=true;
        yield event;
        if(complete)return;
      }
    }
    throw Object.assign(new Error('语音接收不完整，连接已提前结束，请点击朗读重试。'),{code:'speech_stream_incomplete'});
  } finally {if(!complete)await reader.cancel().catch(()=>{});reader.releaseLock();}
}
