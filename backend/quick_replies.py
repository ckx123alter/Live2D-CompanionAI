from .contracts import Reply


# Fixed replies and their public speech cache are shared across sessions.
QUICK_REPLIES = {
    "你真可爱": Reply(text="诶，你是在夸我吗？有、有点不好意思……", emotion="shy", action="Tilt"),
    "今天有点累": Reply(text="那就先在这里歇一会儿吧，我陪着你。今天发生什么了？", emotion="worried", action="Lean"),
    "没token了怎么办": Reply(text="可是我想吃……呜呜呜，你就忍心饿死鱼吗。", emotion="aggrieved", action="Shake"),
    "我有一个好点子": Reply(text="什么好点子？快说快说，我已经准备好夸你啦！", emotion="goofy", action="Point", props=["glasses"]),
    "来玩你画我猜吧": Reply(text="好呀好呀！别小看大肥……本鱼的实力哦！", emotion="smile", action="Nod", topic="drawing_game"),
    "答对了！": Reply(text="哇！我真是太聪明了！接下来我画你猜哦。", emotion="curious", topic="drawing_game"),
}


def quick_reply(text: str) -> Reply | None:
    reply = QUICK_REPLIES.get(text.strip())
    return reply.model_copy(deep=True) if reply else None
