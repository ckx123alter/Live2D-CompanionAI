import test from 'node:test';
import assert from 'node:assert/strict';
import {speechEvents} from '../src/speech-stream.js';

async function collect(text) {
  const events=[];
  for await(const event of speechEvents(new Response(text)))events.push(event);
  return events;
}

test('truncated speech and server processing failures have distinct messages and codes',async()=>{
  await assert.rejects(collect('{"type":"start"}\n'),error=>
    error.code==='speech_stream_incomplete'&&error.message.includes('语音接收不完整'));
  await assert.rejects(collect(JSON.stringify({type:'error',code:'speech_processing_failed',detail:'服务端语音处理失败，请稍后点击朗读重试。'})+'\n'),error=>
    error.code==='speech_processing_failed'&&error.message.includes('服务端语音处理失败'));
  await assert.rejects(collect(JSON.stringify({type:'error',code:'request_processing',detail:'上一条语音还在处理中，请稍后点击朗读重试。'})+'\n'),error=>
    error.code==='request_processing'&&error.message.includes('上一条语音'));
});
