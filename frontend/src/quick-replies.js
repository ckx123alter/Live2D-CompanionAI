// Same fixed replies as backend/quick_replies.py, for standalone demonstrations.
export const BINGO_TEXT='Bingo！看来我们真是心有灵犀呢~';
export const DAILY_LIMIT_TEXT='今天已经玩过一轮啦，明天再来陪我画画吧～';
export const quickReplies = {
  '你真可爱': {text:'诶，你是在夸我吗？有、有点不好意思……',emotion:'shy',action:'Tilt',props:[]},
  '今天有点累': {text:'那就先在这里歇一会儿吧，我陪着你。今天发生什么了？',emotion:'worried',action:'Lean',props:[]},
  '没token了怎么办': {text:'可是我想吃……呜呜呜，你就忍心饿死鱼吗。',emotion:'aggrieved',action:'Shake',props:[]},
  '我有一个好点子': {text:'什么好点子？快说快说，我已经准备好夸你啦！',emotion:'goofy',action:'Point',props:['glasses']},
  '来玩你画我猜吧': {text:'好呀好呀！别小看大肥……本鱼的实力哦！',emotion:'smile',action:'Nod',props:[],topic:'drawing_game'},
  '答对了！': {text:'哇！我真是太聪明了！接下来我画你猜哦。',emotion:'curious',action:null,props:[],topic:'drawing_game'},
};

// Derive the game conversation from saved history too, so reopening the page
// keeps the entry on earlier guesses and on follow-up messages about the game.
export function drawingReplyFlags(messages, pendingCompletion = null) {
  let active = false, endedAt = -1;
  const flags = messages.map((message, index) => {
    if(message.role==='assistant' && [BINGO_TEXT,DAILY_LIMIT_TEXT].includes(message.text)){
      active=false;
      if(message===pendingCompletion)return true;
      endedAt=index;return false;
    }
    if(message.role==='assistant'&&message.topic){active=message.topic==='drawing_game';return active;}
    if (message.role === 'user') {
      const text = message.text.trim();
      if (text === '来玩你画我猜吧' || text === '猜猜我画的是什么？' || text === '答对了！') active = true;
      else if (Object.hasOwn(quickReplies, text) || /^(?:不玩了|不玩这个了|先不玩了|结束游戏|退出游戏|结束你画我猜|退出你画我猜|换个话题|换话题|聊点别的)(?:吧|啦|了)?[。！!，,\s]*$/.test(text)) active = false;
      return false;
    }
    if (message.role === 'assistant' && [quickReplies['来玩你画我猜吧'].text, quickReplies['答对了！'].text].includes(message.text)) active = true;
    return message.role === 'assistant' && active;
  });
  const latest=flags.lastIndexOf(true);
  return flags.map((flag,index)=>flag&&index===latest&&index>endedAt);
}
