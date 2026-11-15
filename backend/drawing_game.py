"""Small stroke library for the character's drawing turn; answers stay server-side."""
import math
import re
import unicodedata
from datetime import datetime, timedelta, timezone

from .contracts import Reply

BINGO_TEXT = "Bingo！看来我们真是心有灵犀呢~"
DAILY_LIMIT_TEXT = "今天已经玩过一轮啦，明天再来陪我画画吧～"
RESUME_GAME_TEXT = "刚才的画还在呢，继续猜猜看吧～"
WRONG_ANSWER_TEXT = "还没猜对哦，再看看我的画嘛。"


def game_day() -> str:
    return datetime.now(timezone(timedelta(hours=8))).date().isoformat()


def is_game_request(text: str) -> bool:
    return bool(re.search(r"你画我猜|我画你猜|猜画|画画猜", text)) or text.strip() == "答对了！"


def daily_limit_reply() -> Reply:
    return Reply(text=DAILY_LIMIT_TEXT, emotion="curious", topic="drawing_game")


def resume_reply() -> Reply:
    return Reply(text=RESUME_GAME_TEXT, emotion="curious", topic="drawing_game", game_intent="resume")


def confirms_guess(text: str) -> bool:
    value = unicodedata.normalize('NFKC', text).strip().lower()
    value = re.sub(r'[\s，,。.!！~～]', '', value)
    return bool(re.fullmatch(r'(?:对|对的|对了|对对对|没错|是的|猜对了|答对了|你猜对了|你答对了|就是这个|就是它|完全正确|正确|没错就是这个|对就是这个|是的你猜对了)(?:呀|啊|哦|啦)?', value))


def oval(x, y, rx, ry, start=0, end=math.tau, steps=48):
    return [[round(x + rx * math.cos(start + (end-start)*i/steps), 1),
             round(y + ry * math.sin(start + (end-start)*i/steps), 1)] for i in range(steps+1)]


DRAWINGS = {
    "cat": {"name": "小猫", "aliases": ["猫", "小猫", "猫咪", "小猫咪", "猫猫", "cat"], "strokes": [
        [[145,218],[137,116],[212,167]], [[300,167],[375,116],[368,220]],
        oval(256,268,128,110), oval(210,248,9,13), oval(302,248,9,13),
        [[244,280],[268,280],[256,291],[244,280]], [[256,291],[256,306],[240,319],[226,311]],
        [[256,306],[272,319],[286,311]], [[173,287],[103,274]], [[174,310],[100,318]],
        [[339,287],[409,274]], [[338,310],[412,318]]]},
    "fish": {"name": "小鱼", "aliases": ["鱼", "小鱼", "鱼儿", "金鱼", "fish"], "strokes": [
        oval(225,260,120,76), [[338,240],[415,187],[415,333],[338,280]],
        oval(166,247,8,8), oval(190,260,18,57,-1.2,1.2),
        [[228,185],[267,141],[291,196]], [[234,335],[273,370],[285,325]],
        oval(89,185,12,12), oval(65,143,18,18)]},
    "house": {"name": "房子", "aliases": ["房子", "房屋", "小房子", "小屋", "房", "屋子", "house"], "strokes": [
        [[108,236],[256,111],[405,236],[108,236]], [[136,238],[136,402],[376,402],[376,238]],
        [[230,402],[230,299],[287,299],[287,402]], [[158,271],[204,271],[204,323],[158,323],[158,271]],
        [[181,271],[181,323]], [[158,297],[204,297]], [[307,171],[307,120],[344,120],[344,202]],
        [[92,402],[421,402]]]},
    "sun": {"name": "太阳", "aliases": ["太阳", "小太阳", "日头", "sun"], "strokes": [
        oval(256,256,90,90), *[[[round(256+120*math.cos(a)),round(256+120*math.sin(a))],
        [round(256+165*math.cos(a)),round(256+165*math.sin(a))]] for a in [i*math.tau/12 for i in range(12)]],
        oval(226,242,5,8), oval(286,242,5,8), oval(256,270,35,25,0,math.pi)]},
    "flower": {"name": "花", "aliases": ["花", "花朵", "小花", "一朵花", "向日葵", "flower"], "strokes": [
        *[oval(256+58*math.cos(a),200+58*math.sin(a),32,32) for a in [i*math.tau/6 for i in range(6)]],
        oval(256,200,30,30), [[256,288],[256,416]],
        [[256,354],[213,308],[176,313],[205,349],[256,354]],
        [[256,381],[299,332],[338,337],[307,375],[256,381]]]},
}


def matches_answer(text: str, drawing: dict) -> bool:
    value = unicodedata.normalize("NFKC", text).lower().strip()
    value = re.sub(r"[\s。.!！?？,，~～]", "", value)
    value = re.sub(r"^(?:我猜(?:是)?|我觉得是|应该是|画的是|这是|是)", "", value)
    value = re.sub(r"(?:对吗|对不对|吧|吗|呀|哦|呢|啊)$", "", value)
    return value in drawing["aliases"]


def answer_reply(correct: bool, drawing: dict) -> Reply:
    if correct:
        return Reply(text=BINGO_TEXT, emotion="loving", action="Lean", affection_delta=5, topic="drawing_game")
    return Reply(text=WRONG_ANSWER_TEXT, emotion="playful", action="Tilt", topic="drawing_game")
