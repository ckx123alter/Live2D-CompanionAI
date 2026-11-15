<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/whalewhis-dark.svg">
    <img src="docs/assets/whalewhis-light.svg" alt="WhaleWhis" width="760">
  </picture>
</p>

<h3 align="center">我要给大肥鱼完整的一生</h3>

<p align="center">
  支持文字聊天、角色语音、表情与动作互动、好感度养成，以及你画我猜小游戏。<br>
  在自己的电脑上，和会回应你的 Live2D 伙伴聊聊天。
</p>

<p align="center">
  <a href="https://whalewhis.xunzhenfuture.tech/"><strong>在线试用 →</strong></a>
  &nbsp; · &nbsp;
  <a href="#1-下载项目">下载项目</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-007ec6" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Python-3.11%2B-3776AB?logo=python&amp;logoColor=white" alt="Python 3.11+">
  <img src="https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&amp;logoColor=white" alt="Node.js 22">
  <img src="https://img.shields.io/badge/FastAPI-009688?logo=fastapi&amp;logoColor=white" alt="FastAPI">
  <img src="https://img.shields.io/badge/Vite-646CFF?logo=vite&amp;logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/Live2D-PixiJS-E87AAB" alt="Live2D / PixiJS">
</p>

---

## 1. 下载项目

在 [GitHub 仓库](https://github.com/ckx123alter/Live2D-CompanionAI) 点击 **Code → Download ZIP**，解压后进入包含 `run.cmd` 的文件夹。后续命令均在这个文件夹中执行。

安装 [Python 3.11+](https://www.python.org/downloads/) 和 [Node.js 22](https://nodejs.org/en/download)。Windows 安装 Python 时勾选 **Add python.exe to PATH**。

## 2. 放入模型和运行库

| 资源 | 获取方式 | 放置位置 |
| --- | --- | --- |
| 大肥鱼模型 | [作者的 Bilibili 获取页面](https://gf.bilibili.com/item/detail/1109618072)，下载并解压 | 将 `大肥鱼.model3.json` 所在目录的**全部内容**放入 `frontend/public/model/` |
| Live2D Core | 下载 [Cubism SDK for Web](https://www.live2d.com/sdk/download/web/)，从 `Core` 目录取出 `live2dcubismcore.min.js` | `frontend/public/vendor/live2dcubismcore.min.js` |

模型放好后，入口应为 `frontend/public/model/大肥鱼.model3.json`。保留贴图、`Exp3/` 和 `Animation/` 等配套文件，不要多套一层文件夹。

背景音乐文件为 `frontend/public/audio/轻松的，愉悦的树林子.mp3`，特别鸣谢黑耀耀_officialてす老师提供素材。

## 3. 填写 API Key

将根目录的 `.env.example` 复制一份，命名为 `.env`，用文本编辑器打开。

| 功能 | 获取 Key | 填写位置 |
| --- | --- | --- |
| AI 聊天 | [DeepSeek 开放平台](https://platform.deepseek.com/api_keys)，登录后创建 API Key | `.env` 中的 `LLM_API_KEY` |
| 角色语音（可选） | [豆包语音控制台](https://console.volcengine.com/speech/new/setting/apikeys?ResourceID=volc.seedicl.default&projectName=default)，开通语音合成，在 API 管理中创建 Key | `.env` 中的 `DOUBAO_TTS_API_KEY` |

修改以下两项，其余配置保持默认：

```dotenv
LLM_API_KEY=你的DeepSeek密钥
DOUBAO_TTS_API_KEY=你的豆包语音密钥
```

## 4. 安装并启动

### Windows

完成前面的准备后，双击 **`run.cmd`** 即可。首次启动会自动安装依赖、初始化模型并打开 [本地页面](http://127.0.0.1:5173)，请保持联网并等待完成；以后也直接双击启动。

修改 `.env` 后需重启后端才能生效。

### Linux / macOS

Linux / macOS 不支持运行 `run.cmd`。准备好模型、Core 和 `.env` 后，在项目根目录的终端中执行：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm --prefix frontend ci
.venv/bin/python scripts/prepare_model.py
npm --prefix frontend run build
.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

访问 [http://127.0.0.1:8000](http://127.0.0.1:8000)，按 `Ctrl+C` 停止。

模型不显示时，检查第 2 步的目录；聊天失败时，检查 Key、账户额度和后端是否运行；没有声音时，检查语音 Key、服务权限及自动朗读开关。

## 署名与许可

模型：DeepSeek-chan（大肥鱼）。原画及拆分：神宫凉子；Live2D 建模：霓虹猫_NeonNeko。请通过作者页面获取模型，遵守 [模型使用须知](MODEL-NOTICE.txt)，勿重新上传完整模型。

项目代码采用 [MIT License](LICENSE)。模型、Live2D Core、音乐及第三方依赖遵循各自许可。
