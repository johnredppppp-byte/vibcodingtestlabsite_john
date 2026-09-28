# 用 Python 从零搭建编程实验网站

**实践说明书 · 2026 年 9 月 · 第一版**

这是一份供你自己动手的路线图。已经完成的网站源码在本仓库的 `app/`、`lib/`、`db/` 等目录；那一版使用 React、TypeScript 和云端数据库。本说明书教你**另起一个 Python 项目**，逐步做出功能相近的研究工具，而不是把现有 TypeScript 文件改名为 `.py`。

建议先做出可在自己电脑上操作的版本，再处理真实学生登录、评分和上线。你目前的研究任务可以先以 **Excel 自动化** 为正式任务；现有网站的爬虫任务是第二个未发布草稿，练习时可用来检验多任务设计，是否纳入正式实验由研究方案决定。

## 你最终要做出的东西

学生打开网页，右边看到固定任务要求，左边与 AI 对话，最后上传 `.py` 和结果文件。研究者在 `/admin` 编辑任务、导入评分标准、查看学生与每条 prompt、下载代码、CSV 和 Markdown 评分报告。prompt 的分数不显示给学生。

| 部分 | 建议技术 | 作用 |
| --- | --- | --- |
| 页面 | HTML、CSS、少量原生 JavaScript；Jinja2 模板 | 对话框、侧栏、上传控件。浏览器需要少量 JavaScript 才能无刷新发消息。 |
| 网站后端 | Python + FastAPI | 路由、鉴权、调用 AI、控制数据流。 |
| 数据库 | 本地先用 SQLite；正式部署按平台条件选 PostgreSQL | 保存参与者、任务版本、对话、评分和用量。 |
| 文件 | 开发时本地目录；上线时持久化对象存储 | 保存任务材料、`.py`、结果文件。 |
| 外部服务 | Google Identity Services、对话 AI、PromptOS、评分 AI | 登录、对话和两种评分。 |

总体数据流：浏览器 → FastAPI → 数据库；FastAPI 再调用对话 AI。每条 prompt 同时进入待评分队列；后台工作程序调用 PromptOS。最终代码进入文件存储和代码评分队列，研究者下载报告。

## 第 0 步：确定边界和实验记录

先在纸上画一张页面：左侧聊天、右侧任务、底部代码提交；另画 `/admin` 的任务、参与者、prompt、提交和设置五页。先决定以下规则，并写入 `study_protocol.md`：

1. 固定任务文本和输入文件。Excel 任务可以写“对缺失单价用已有数据作合理估计，保留原价和全部订单，并标记估计值”；不强制回归补全，也不因使用回归额外加分。
2. 固定模型及参数、每人每任务的时间限制、允许提交的文件类型；预先说明是否允许多次提交。建议第一版每人每任务一次最终提交。
3. 明确最终程序的分数来自**AI 静态审阅**。想要证明“可运行”，需要在独立、隔离的执行环境中测试，不能把模型的文字判断当成运行结果。
4. 区分 `student_id`（随机实验 ID）、`student_no`（流水序号）和 `google_sub`（仅用于识别同一 Google 账号）。导出分析表优先用实验 ID，不需要把邮箱交给评分服务。

**完成标准：**你能向别人解释“一个学生发一条 prompt”时，数据库会多出哪些记录，学生和研究者分别能看到什么。

## 第 1 步：跑起第一个 Python 页面

在 Windows PowerShell 中新建项目。下例的 `python` 请换成你电脑上实际可用的 `py` 或 `python3`，一次使用同一种即可。

```powershell
mkdir prompt-study-python
cd prompt-study-python
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install "fastapi[standard]" jinja2 httpx google-auth python-multipart
mkdir templates, static, uploads
```

macOS / Linux 激活命令是 `source .venv/bin/activate`；如果 Windows 拒绝执行激活脚本，可以直接运行 `.venv\Scripts\python.exe -m pip ...`，不需要修改系统安全策略。新建 `main.py`：

```python
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

app = FastAPI(title="Python 编程实验")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

@app.get("/health")
def health():
    return {"ok": True}

@app.get("/", response_class=HTMLResponse)
def student_page(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="student.html",
        context={"task_title": "Excel 自动化"},
    )
```

新建 `templates/student.html`，先只做结构，再美化：

```html
<!doctype html>
<html lang="zh">
<meta charset="utf-8">
<title>编程实验</title>
<link rel="stylesheet" href="/static/style.css">
<main class="layout">
  <section class="chat"><h1>AI 对话</h1><div id="messages"></div>
    <form id="chat-form"><textarea id="prompt" required></textarea>
      <button>发送</button></form>
  </section>
  <aside class="task"><h2>{{ task_title }}</h2>
    <p>用 Python 读取销售 Excel，估计缺失单价并输出报表。</p>
  </aside>
</main>
<script src="/static/app.js" defer></script>
</html>
```

在 `static/style.css` 写一个两列布局：`.layout {display:grid;grid-template-columns:minmax(0,2fr) minmax(18rem,1fr);gap:1.5rem}`，再为窄屏添加单列媒体查询。`static/app.js` 此时只要能截获表单提交并在页面插入自己的消息即可。运行 `python -m uvicorn main:app --reload`，打开 `http://127.0.0.1:8000/` 和 `/docs`。

**完成标准：**页面可以打开、任务出现在右边、`/health` 返回 `{"ok":true}`。此时不要接真实 AI。

## 第 2 步：建数据库；先保存再处理

使用 Python 自带的 `sqlite3`，新建 `database.py`，逐张建表；每个请求新开连接，用参数化 SQL（`?` 占位），提交后关闭。开发版建议至少有以下表：

| 表 | 核心字段 | 必须保证的约束 |
| --- | --- | --- |
| `participants` | `id`, `seq`, `google_sub`, `email`, `created_at` | `id`、`google_sub` 唯一；`seq` 自动递增。 |
| `tasks` | `id`, `title`, `content`, `rubric_md`, `version`, `published` | 编辑后版本递增。 |
| `study_sessions` | `id`, `student_id`, `task_id`, `task_snapshot`, `started_at`, `finished_at` | 同一学生与任务至多一个会话。 |
| `messages` | `id`, `session_id`, `role`, `text`, `request_id`, `status`, `created_at`, `model`, `usage_json` | `request_id` 唯一，以防重复点击产生重复记录。 |
| `jobs` | `id`, `kind`, `target_id`, `status`, `attempts`, `result_json`, `score`, `error` | 同一评分类型和目标只建一个任务。 |
| `submissions` | `id`, `session_id`, `code_path`, `sha256`, `note`, `created_at` | 只接受会话所有者提交。 |

写好数据表后增加 `POST /api/sessions`：检查已发布任务，创建会话时把当时的任务要求和评分标准复制到 `task_snapshot`。以后改任务文字，也不改变已参加学生的实验条件。

**完成标准：**重启网站后，学生 ID、任务和会话还在；同一账号再次进入得到同一个实验 ID；任务修改后，旧会话仍显示旧版要求。

## 第 3 步：加入 Google 登录

这一步开始之前，可用一个仅在自己电脑上启用的测试身份完成第 2 步。正式让学生访问前必须关掉测试入口。Google 按其官方说明创建 Web Client ID，并在客户端取得 ID token；将 token POST 给 Python。服务器验证签名、audience、issuer 和有效期，以 `sub` 查找或创建学生；**不要用邮箱当唯一 ID**，因为邮箱可能变化。

```python
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

def verified_google_identity(credential: str, client_id: str) -> dict:
    claims = id_token.verify_oauth2_token(
        credential, google_requests.Request(), client_id
    )
    if claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise ValueError("Google issuer 不正确")
    if not claims.get("sub") or claims.get("email_verified") is not True:
        raise ValueError("Google 账号信息不完整")
    return claims
```

这是**身份验证函数**，不是完整的登录路由。路由还要核对登录 nonce / CSRF、处理重复创建的数据库竞争、发放随机服务端会话 cookie（`HttpOnly`、`Secure`、`SameSite=Lax`）并限制登录频率。为研究者使用单独的管理员身份；不要把“访问 `/admin` 页面”视为已经授权，所有管理 API 也必须检查身份。

**完成标准：**同一个 Google 账号每次登录得到同一 ID，不同账号得到不同 ID；把普通学生的 cookie 用于管理接口时返回 403。

## 第 4 步：接入对话 AI，并保留每轮原始 prompt

增加 `POST /api/chat`，请求含 `session_id`、`request_id`、`text`。服务器先检查登录、会话归属、任务是否结束、字数上限和限流，再进行以下动作：

1. 读取该会话的历史消息，组装发送给模型的完整上下文。
2. **先**把学生原文、上下文、模型名和状态 `pending` 写入 `messages`，同时向 `jobs` 插入一条 `kind=prompt` 的待评分任务。
3. 调用 AI；成功后保存 AI 回复、token 用量，把该 prompt 状态改为 `completed`；失败时把状态改为 `failed` 并保留原文和错误，不要直接丢失这一轮。
4. 只向学生返回回复或连接错误，不返回 PromptOS 的分数。

最小化的 OpenAI 兼容请求示例：

```python
import httpx

def ask_model(messages: list[dict], base_url: str, api_key: str, model: str):
    response = httpx.post(
        base_url.rstrip("/") + "/chat/completions",
        headers={"Authorization": f"Bearer {api_key}"},
        json={"model": model, "messages": messages, "stream": False},
        timeout=60,
    )
    response.raise_for_status()
    data = response.json()
    return data["choices"][0]["message"]["content"], data.get("usage")
```

正式配置的 API key 只放服务器环境变量或受保护的机密配置；浏览器不能得到它。模型接口各有兼容差异，推理模型是否接受 `temperature`、`max_tokens` 等字段要按供应商文档实际测试。保存供应商返回的 `usage`，供实验后核算费用。任务文本默认只在右侧显示；要不要也放进 AI 系统提示，须在实验设计时确定，不能中途变更。

**完成标准：**发送三次 prompt，数据库里有三条原文、三条独立评分任务以及对应回复；故意断开 AI 接口时原文仍保留；刷新页面后能恢复对话。

## 第 5 步：接 PromptOS，评分不实时显示

单独写一个 `promptos_client.py`。先向服务提供方确认**实际可调用的接口、授权方式、请求体、评分尺度和返回格式**；现有网站里预填的 URL 只是适配位置，不能当作稳定公开 API 的保证。已有适配设计是 POST `{"prompt":"原文"}`，期望返回 `overallScore`（0—100）、六个维度分数（各 1—10）及 `feedback`；对不上真实接口时改这一层，不要改原始研究记录。

增加后台命令 `python worker.py`：循环领取 `pending` 任务；只把学生的**原始 prompt**发送给 PromptOS，验证返回范围并保存原始 JSON、总分、评分服务和时间。失败保留错误及重试次数，不能把“接口失败”当作 0 分。先用管理端的“处理待评分”按钮完成本地练习；正式上线要有可持续运行的 worker 或受控调度器。仅靠 FastAPI 的请求结束后台任务，不能保证崩溃之后的任务仍被执行。

**完成标准：**学生刷新页面始终看不到分数；管理端能查看每条的 `pending / completed / failed` 状态、分数和错误；重试失败任务不会复制评分记录。

## 第 6 步：研究者后台与任务版本

把后台分成五个简单页面：参与者、任务、Prompt、代码提交、设置/队列。任务编辑表单可以填标题、要求、时长、Markdown 评分标准、是否发布以及材料；发布后学生仅看到任务要求和材料，评分标准仅用于研究者和评分程序。每次编辑任务内容或评分标准，版本号加一。保留旧会话快照，不覆盖旧条件。

**完成标准：**管理者修改 Excel 任务以后，已经开始的会话仍使用旧文字；新学生使用新版；CSV 中能区分任务版本。

## 第 7 步：收取代码、静态评分和报告

`POST /api/submissions` 接收 `.py` 和至多几份结果文件。验证扩展名、内容与大小，按随机 ID 存放；不要直接用用户给的文件名拼出服务器路径。记录文件的 SHA-256，再将提交加入 `kind=code` 的任务队列。AI 评分输入包括当次会话冻结的要求、Markdown rubric、学生代码和简短说明。学生提交的注释可能含指令，应作为待审材料，不能让它改写评分规则。要求评分接口返回可校验 JSON（总分 0—100，各项分之和等于总分）；校验失败标记任务失败，供研究者复核。

生成 `grade-<submission_id>.md`：写明实验 ID、任务版本、代码 SHA-256、模型及返回的模型版本、评分时间、分项分与理由，并显著标注“仅静态审阅，未运行程序，未验证结果文件”。若以后要真的运行学生代码，必须另外设计隔离、资源上限和无外网权限的执行环境，不要在 FastAPI 进程里直接 `exec` 或运行上传的 `.py`。

**完成标准：**上传正常 `.py` 可获得报告；恶意文件名、超大文件、重复提交被拒绝；AI 回复无效 JSON 时不产生伪造的分数。

## 第 8 步：导出分析数据并预实验

研究者下载 `participants.csv`、`prompts.csv`、对话 JSON、上传代码和对应 Markdown。Prompt CSV 一行对应**一条学生 prompt**，建议含 `record_no, student_no, student_id, task_id, task_version, session_id, prompt_id, prompt, created_at, reply_status, chat_model, prompt_score_status, prompt_score, score_json, scored_at`。代码评价可另外导出 `submissions.csv`。在 CSV 中对可能以 `= + - @` 开头的学生输入做电子表格公式注入防护，并明确时区、缺失值和失败状态。

请用两位测试者做完整预实验，逐项核对：不同 Google 账号、每人多轮 prompt、AI 断线、PromptOS 失败重试、最终代码与输出、任务修改前后的版本、下载权限、CSV 与 Markdown 的字段、实际 AI 用量。先确保保存每轮提示及实际评分，然后才招募正式参加者。

**完成标准：**仅拿下载文件就能复原“哪个参与者在什么任务版本下给了哪些 prompt、每条如何评分、最终交了什么代码”。

## 推荐项目结构

```text
prompt-study-python/
├── main.py                 # FastAPI 入口、页面路由
├── database.py             # 连接与建表
├── models.py               # 输入输出结构；表多时再加 ORM
├── auth.py                 # Google 验证与会话
├── chat_service.py         # 对话 AI
├── promptos_client.py      # PromptOS 适配
├── grader.py               # 静态评分与 Markdown
├── worker.py               # 持久任务处理
├── templates/
│   ├── student.html
│   └── admin.html
├── static/
│   ├── app.js
│   └── style.css
├── tests/                   # 关键数据流的少量验证
├── uploads/                 # 本地开发文件，禁止提交
├── .gitignore
└── .env.example             # 只列变量名与示例占位符
```

`.gitignore` 至少包含 `.venv/`, `__pycache__/`, `.env`, `*.db`, `uploads/`, `*.pem`。`.env.example` 可以列 `GOOGLE_CLIENT_ID=`, `CHAT_API_KEY=`, `CHAT_MODEL=`, `PROMPTOS_URL=`, `GRADE_API_KEY=`；绝不填写真实值。运行成本主要取决于每人发送的轮次、模型输入上下文增长、评分模型调用和 PromptOS 的收费方式；正式实验前用预实验导出的 token 用量估算。

## 我建议的练习顺序

先连续完成第 1、2、4 步：你会看到自己的 Python 页面、数据库和 AI 聊天已经串起来。接着完成第 3 步，锁定真实学生身份；最后依次做第 5 至第 8 步。每通过一个“完成标准”就保存一次 Git 提交，例如 `git commit -m "Save prompts before chat requests"`。这能让你随时回到一个运行正常的阶段。

已有网站可以作为**功能参照**，但它不是本练习的 Python 模板。你自己重做的版本仍需要新项目、新部署和独立的数据库；不要直接把真实实验数据迁过去或同时开放两个系统来收集同一批学生。

## 官方参考

- Python 虚拟环境：https://docs.python.org/3/library/venv.html
- FastAPI 第一步：https://fastapi.tiangolo.com/tutorial/first-steps/
- FastAPI SQL 数据库：https://fastapi.tiangolo.com/tutorial/sql-databases/
- FastAPI 文件上传：https://fastapi.tiangolo.com/tutorial/request-files/
- FastAPI 后台任务说明：https://fastapi.tiangolo.com/tutorial/background-tasks/
- Google ID token 服务端验证：https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
- Google 登录按钮：https://developers.google.com/identity/gsi/web/guides/display-button
- SQLAlchemy 入门（表多后可升级）：https://docs.sqlalchemy.org/en/20/orm/quickstart.html
