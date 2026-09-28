# PromptLab 使用说明

## 首次准备

1. 打开 `/admin`，使用交付时提供的管理口令登录。
2. 在“接口设置”填入 Google Web OAuth Client ID。Google Cloud 中“获授权的 JavaScript 来源”须与最终站点 origin 完全一致。
3. 配置对话 AI、代码评分 AI 的 OpenAI 兼容 Base URL、模型与 API Key。API Key 在服务器端加密保存。
4. 保存后分别测试接口。PromptOS 使用独立的完整 URL，协议是 POST `{ "prompt": "原始输入" }`，返回 `overallScore`（0–100）、`criteriaScores`（六项各 1–10）、`feedback`。预填地址来自 PromptOS 项目现有代码；它不是已确认有稳定承诺的公共 API。需要服务提供者支持可访问的接口。
5. 在“任务设计”编辑两道初始草稿，上传统一 Excel 材料、填写统一爬虫目标网址，导入 Markdown 评分标准，发布任务。
6. 开放实验。当前站点默认仅站点所有者可访问；邀请学生前还须设置合适的站点访问范围。

## 记录与评分

- Google ID Token 的签名、issuer、audience、exp 与 nonce 在服务端验证；使用 `sub` 唯一映射学生 ID。UUID 与 Google sub 都有唯一索引。序号允许有间隔。
- 每个学生每个任务保留一个会话；开始时冻结任务要求、材料列表和评价标准。
- Prompt 原文与完整发给 AI 的上下文先写入数据库，再请求对话 API。任务说明不会自动作为系统提示插入。
- 每条 Prompt 独立加入 PromptOS 队列。评分在后台进行，不写入学生响应。
- 每次新增数据触发后台队列；管理端队列页打开时持续处理，可重试失败 / 待配置记录。队列持久化，但未接入外部定时调度；后台工作被中断时，可重新打开队列页恢复。
- AI 服务返回的对话 token 用量与代码评分 token 用量会随研究记录保存；完整对话 JSON 包含每轮 assistant 记录中的 `context_json.usage`。以服务商的 `prompt_tokens`、`completion_tokens` 为准计算正式实验的实际费用。推理模型的隐藏推理 token 计入 `completion_tokens`。PromptOS 若未返回 usage，本平台无法凭空得知该服务内部用量。
- 学生上传最终 `.py` 文件后结束该任务，并可附带最多三个结果文件。程序不在服务器执行。
- 代码评分为 AI 静态审阅。报告包含任务与 Rubric 版本、代码 SHA-256、模型、接口、时间与各项评分，明确说明未运行代码。
- 评分失败不会记为零分。外部服务未返回模型版本时保留“服务未返回模型版本”，不臆造版本。
- CSV 使用 UTF-8 BOM 与完整引用，并防护公式注入；完整对话另外导出 JSON。时间戳是 UTC Unix 毫秒。

## 验证边界

正式实验前，仍需用真实 Google 账号和研究者的 AI / PromptOS 配置做端到端预实验，并实际执行提交程序，复核 AI 评分。第一版不包含自动代码执行沙箱、自动记录本地编辑过程、背景问卷或独立的爬虫实验网站。

## 开发

代码使用 Vinext、D1、R2。数据库结构在 `db/schema.ts`，迁移文件由 Drizzle 生成。`lib/server.ts` 负责认证与服务器配置，`lib/scoring.ts` 负责评分适配器和队列，API 集中于 `app/api/[...path]/route.ts`。服务器环境变量 `ADMIN_PASSWORD_HASH` 与 `SETTINGS_ENCRYPTION_KEY` 必须以机密配置，禁止提交到 Git。`SETTINGS_ENCRYPTION_KEY` 是 Base64 编码的 32 字节随机密钥，不可随意更换，否则已保存的 API 密钥将无法解密。
