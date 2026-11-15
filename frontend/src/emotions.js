export const emotionIds = Object.freeze([
  'neutral','loving','shy','aggrieved','smile','yandere','thinking','playful',
  'speechless','guilty','angry','curious','startled','sadness','worried','goofy',
]);
// Do not reuse old IDs for another expression: stored replies must keep their face.
export const legacyEmotions = Object.freeze({
  happy:'loving',sad:'aggrieved',sleepy:'sadness',laugh:'curious',
  smug:'speechless',sweat:'guilty',puff:'angry',tongue:'playful',
});
export function normalizeEmotion(value) {
  if(typeof value!=='string')return 'neutral';
  const id=Object.hasOwn(legacyEmotions,value)?legacyEmotions[value]:value;
  return emotionIds.includes(id)?id:'neutral';
}
