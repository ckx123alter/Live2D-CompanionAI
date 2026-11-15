import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { installSpeechMouth } from '../src/speech-mouth.js';

const asset=path=>new URL(`../public/${path}`,import.meta.url);
const hasModel=['vendor/live2dcubismcore.min.js','model/大肥鱼.moc3','model/大肥鱼.cdi3.json'].every(path=>existsSync(asset(path)));

test('real rig uses neutral speech mouth while preserving expression eyes, then restores it',
  {skip:!hasModel},async()=>{
    const context=vm.createContext({console,WebAssembly,TextDecoder,TextEncoder,setTimeout,clearTimeout,atob});
    vm.runInContext(readFileSync(asset('vendor/live2dcubismcore.min.js'),'utf8'),context);
    await new Promise(resolve=>setTimeout(resolve,500));
    const C=context.Live2DCubismCore, bytes=readFileSync(asset('model/大肥鱼.moc3'));
    const moc=C.Moc.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    const raw=C.Model.fromMoc(moc),p=raw.parameters,d=raw.drawables;
    const info=JSON.parse(readFileSync(asset('model/大肥鱼.cdi3.json'),'utf8'));
    let speaking=false,time=0,restingOpening=.7;
    const core={getModel:()=>raw,update:()=>{raw.update();d.resetDynamicFlags();}};
    installSpeechMouth(core,info,()=>speaking,{now:()=>time,getRestingOpening:()=>restingOpening});
    const advance=milliseconds=>{time+=milliseconds;core.update();};
    const pose=values=>{p.values.set(p.defaultValues);for(const [id,value] of Object.entries(values))p.values[p.ids.indexOf(id)]=value;};
    const mesh=id=>{const i=d.ids.indexOf(id);return {opacity:d.opacities[i],vertices:Array.from(d.vertexPositions[i])};};
    try {
      pose({ParamMouthOpenY:.7});core.update();const normal=mesh('ArtMesh90');
      for(const expression of [{key6:1},{key9:1,ParamMouthForm:1},{TongueOut:1},
        {CheeckPuff:1,ParamMouthForm:-1},{key2:1,ParamMouthForm:-.7},{Mouthpucker:1}]){
        speaking=false;pose({...expression,ParamMouthOpenY:.7,key10:1});core.update();
        const eye=mesh('ArtMesh350'),expressionMouth=mesh('ArtMesh90');
        const parameters=Array.from(p.values);
        speaking=true;core.update();
        assert.deepEqual(mesh('ArtMesh90'),expressionMouth,'speech start must not jump');
        advance(130);
        if(expression.key6){
          assert.equal(mesh('ArtMesh345').opacity,.5,'static mouth must fade out');
          assert.equal(mesh('ArtMesh90').opacity,.5,'normal mouth must fade in');
        }
        advance(130);
        assert.deepEqual(mesh('ArtMesh90'),normal,'mouth must use neutral shape');
        assert.deepEqual(mesh('ArtMesh350'),eye,'expression eyes must remain unchanged');
        assert.equal(mesh('ArtMesh345').opacity,0,'static expression mouth must be hidden');
        assert.deepEqual(Array.from(p.values),parameters,'expression/prop parameters must be preserved');
        speaking=false;core.update();
        assert.deepEqual(mesh('ArtMesh90'),normal,'speech end must not jump');
        advance(130);
        if(expression.key6)assert.equal(mesh('ArtMesh345').opacity,.5);
        advance(130);
        assert.deepEqual(mesh('ArtMesh90'),expressionMouth,'expression mouth must restore after speech');
      }
      speaking=true;pose({key6:1,ParamMouthOpenY:0});core.update();advance(260);const closed=mesh('ArtMesh90');
      pose({key6:1,ParamMouthOpenY:.8});core.update();
      assert.notDeepEqual(mesh('ArtMesh90').vertices,closed.vertices,'audio opening must actually change mouth geometry');
      const open=mesh('ArtMesh90');
      // Match the app: its input opening changes to the resting expression as
      // soon as audio ends. The displayed mouth must still fade from the audio.
      speaking=false;restingOpening=.1;pose({key6:1,ParamMouthOpenY:.1});core.update();
      assert.deepEqual(mesh('ArtMesh90'),open);
      advance(130);
      const halfway=mesh('ArtMesh90'),staticHalfway=mesh('ArtMesh345');
      // Restarting audio midway must retarget from the visible blended pose.
      speaking=true;pose({key6:1,ParamMouthOpenY:.8});core.update();
      assert.deepEqual(mesh('ArtMesh90'),halfway);
      assert.deepEqual(mesh('ArtMesh345'),staticHalfway);
      advance(260);assert.equal(mesh('ArtMesh345').opacity,0);
      speaking=false;pose({key6:1,ParamMouthOpenY:.1});core.update();advance(260);
      assert.equal(mesh('ArtMesh345').opacity,1);
    } finally {raw.release();moc._release();}
  });
