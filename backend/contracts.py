import base64
import binascii
import struct
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Emotion = Literal["neutral", "loving", "shy", "aggrieved", "smile", "yandere", "thinking", "playful", "speechless", "guilty", "angry", "curious", "startled", "sadness", "worried", "goofy"]
Action = Literal["Wave", "Point", "Grass", "Lean", "Tilt", "Nod", "Shake", "Rest"]
Prop = Literal["pot", "glasses", "monocle", "flowers"]
EMOTIONS = set(Emotion.__args__)
LEGACY_EMOTIONS = {
    "happy": "loving", "sad": "aggrieved", "sleepy": "sadness",
    "laugh": "curious", "smug": "speechless", "sweat": "guilty",
    "puff": "angry", "tongue": "playful",
}


def normalize_emotion(value) -> str:
    if not isinstance(value, str):
        return "neutral"
    value = LEGACY_EMOTIONS.get(value, value)
    return value if value in EMOTIONS else "neutral"


ACTIONS = set(Action.__args__)
PROPS = set(Prop.__args__)


def normalize_props(value) -> list[str]:
    if not isinstance(value, list):
        return []
    result = []
    for prop in value:
        if not isinstance(prop, str) or prop not in PROPS or prop in result:
            continue
        if prop in {"glasses", "monocle"} and {"glasses", "monocle"}.intersection(result):
            continue
        result.append(prop)
    return result


class Reply(BaseModel):
    text: str = Field(min_length=1, max_length=1200)
    emotion: Emotion = "neutral"
    action: Action | None = None
    props: list[Prop] = Field(default_factory=list, max_length=4)
    affection_delta: int = Field(default=0, ge=-10, le=10)
    topic: Literal["chat", "drawing_game"] = "chat"
    game_intent: Literal["none", "resume", "answer", "confirm"] = "none"
    # Internal semantic verdict; settlement and rewards remain server-controlled.
    game_answer_correct: bool | None = Field(default=None, strict=True, exclude=True)

    @field_validator("emotion", mode="before")
    @classmethod
    def migrate_emotion(cls, value):
        # Compatibility only; model prompts and new records use canonical IDs.
        return LEGACY_EMOTIONS.get(value, value) if isinstance(value, str) else value

    @model_validator(mode="after")
    def fixed_reply_action(self):
        if self.text == "唔......触及到我的知识盲区了。":
            self.action = "Shake"
        return self

    @field_validator("props", mode="before")
    @classmethod
    def validate_props(cls, value):
        return normalize_props(value)


class ChatRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    text: str = Field(min_length=1, max_length=1000)
    request_id: UUID


class DrawingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    image: str = Field(max_length=700_000)

    @field_validator("image")
    @classmethod
    def validate_image(cls, value: str) -> str:
        prefix = "data:image/png;base64,"
        if not value.startswith(prefix):
            raise ValueError("画板仅支持 PNG 图片")
        try:
            raw = base64.b64decode(value[len(prefix):], validate=True)
        except (ValueError, binascii.Error) as error:
            raise ValueError("图片编码无效") from error
        if len(raw) > 512 * 1024 or len(raw) < 45 or raw[:8] != b"\x89PNG\r\n\x1a\n":
            raise ValueError("图片格式或大小无效")
        if raw[8:16] != b"\x00\x00\x00\rIHDR":
            raise ValueError("图片头无效")
        width, height = struct.unpack(">II", raw[16:24])
        if not (1 <= width <= 512 and 1 <= height <= 512):
            raise ValueError("画板图片不能超过 512 像素")
        # Check the complete PNG envelope before forwarding to the image provider.
        offset, has_pixels, ended = 8, False, False
        while offset + 12 <= len(raw):
            size = int.from_bytes(raw[offset:offset + 4], "big")
            end = offset + 12 + size
            if end > len(raw):
                raise ValueError("图片不完整")
            chunk = raw[offset + 4:offset + 8]
            payload = raw[offset + 4:end - 4]
            if binascii.crc32(payload) != int.from_bytes(raw[end - 4:end], "big"):
                raise ValueError("图片校验失败")
            has_pixels |= chunk == b"IDAT"
            offset = end
            if chunk == b"IEND":
                ended = size == 0 and offset == len(raw)
                break
        if not has_pixels or not ended:
            raise ValueError("图片不完整")
        return value


class DrawingRoundRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID


class DrawingSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["user", "character", "finished"] = "user"
    image: str | None = Field(default=None, max_length=700_000)
    round_id: UUID | None = None
    progress: float = Field(default=0, ge=0, le=1, allow_inf_nan=False)
    paused: bool = False
    can_confirm: bool = False
    feedback: str = Field(default="", max_length=1200)

    @field_validator("image")
    @classmethod
    def png_only(cls, value):
        return DrawingRequest.validate_image(value) if value else value


class DrawingStateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(ge=0)
    state: DrawingSnapshot


class DrawingAnswerRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    request_id: UUID
    round_id: UUID
    text: str = Field(min_length=1, max_length=120)


class SpeechRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message_id: int | None = Field(default=None, gt=0)
    preset: Literal["welcome"] | None = None

    @model_validator(mode="after")
    def one_source(self):
        if (self.message_id is None) == (self.preset is None):
            raise ValueError("Exactly one speech source is required")
        return self


class LoginRequest(BaseModel):
    password: str = Field(max_length=256)
