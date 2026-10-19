# AI API Key 接入指南

本文说明如何给“消息识别”配置模型。API Key 只存放在 Supabase Edge Function Secrets，**不要写进 `.env`、前端代码、Windows 安装包或 Android APK，也不要发到聊天窗口**。

## 先选服务

### 选项 A：Gemini

适合先试用文本任务识别。到 [Google AI Studio API Keys](https://aistudio.google.com/apikey) 创建密钥。当前代码使用模型 `gemini-3.8-flash`；免费额度、地区和速率限制会调整，先查看 [Gemini API 定价](https://ai.google.dev/gemini-api/docs/pricing) 与 [速率限制](https://ai.google.dev/gemini-api/docs/rate-limits)。截至本指南编写时，Gemini API 免费层的请求内容可能用于改进 Google 产品；如果聊天文本较敏感，请选择其他符合你隐私要求的服务或不要提交该内容。

Google 已在 2026 年 9 月开始拒绝不受限制的旧式 Standard Key。新建或使用密钥时，按 AI Studio 的提示使用 Auth Key，或将 Standard Key 限制为只访问 Gemini API。不要使用公开、未限制的密钥。

### 选项 B：OpenAI API

到 [OpenAI API Keys](https://platform.openai.com/api-keys) 创建 API Key，模型填写你的 API 项目当前可用的文本模型。**ChatGPT Plus/Pro 等订阅与 API 平台分别计费**；使用 API 前请检查 API 项目的余额、预算和费率：[账单说明](https://help.openai.com/en/articles/9039756-managing-billing-for-the-chatgpt-and-the-api-platform)。

## 配置 Supabase Secrets

1. 打开 Supabase Dashboard 中的项目。
2. 进入 **Edge Functions → Secrets**（部分 Dashboard 版本把它放在项目设置的 Edge Functions 页面）。
3. 添加下列环境变量。`AI_API_KEY` 的值填你刚取得的密钥，不要带尖括号。

Gemini 示例：

```text
AI_PROVIDER=gemini
AI_MODEL=gemini-3.8-flash
AI_API_KEY=你的 Gemini API Key
```

OpenAI 示例：

```text
AI_PROVIDER=openai
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=你账户可用的模型 ID
AI_API_KEY=你的 OpenAI API Key
```

更换供应商时，更新或删除旧的 `AI_BASE_URL`，避免误用旧配置。Supabase 已自动提供的 `SUPABASE_URL`、`SUPABASE_ANON_KEY` 不需要手动覆盖；不要把 service role key 加进客户端。

## 部署消息识别函数

项目已有函数源文件：`backend/functions/extract-message/index.ts`。Supabase CLI 默认读取 `supabase/functions` 目录，因此第一次部署时在项目根目录 PowerShell 执行：

```powershell
npx supabase init
New-Item -ItemType Directory -Force supabase/functions/extract-message
Copy-Item backend/functions/extract-message/index.ts supabase/functions/extract-message/index.ts -Force
npx supabase login
npx supabase link --project-ref 你的Supabase项目Ref
npx supabase functions deploy extract-message --use-api
```

项目 Ref 是 Supabase 项目 URL 中 `.supabase.co` 前的部分。CLI 登录会打开授权流程；不要把 Access Token 写进项目文件。以后修改函数时，先将 `backend/functions/extract-message/index.ts` 复制到 `supabase/functions/extract-message/index.ts`，再重新部署。

也可以在 Supabase Dashboard 中新建 Edge Function `extract-message`，将上述源文件内容粘贴到编辑器并部署。Secrets 先配置好再部署。

## 在应用中验证

1. 确认 Supabase 项目已执行 `backend/supabase.sql`，Windows 或 Android 应用使用该项目对应的 URL 与 publishable key 构建。
2. 打开应用，用已注册账号登录。
3. 进入“消息识别”，粘贴一条不敏感的测试消息并点击“分析消息”。
4. 成功时结果只进入“待审核”；只有点击“确认加入待办”才会创建任务。

客户端会根据 `VITE_SUPABASE_URL` 自动拼出 `.../functions/v1/extract-message`。因此只变更模型 Secrets、或重新部署同名函数后，**不需要重新构建客户端**。若更换 Supabase 项目，才需要更新客户端 Supabase URL/key 并重新构建桌面和 Android 包。

常见错误：

| 提示/状态 | 检查内容 |
|---|---|
| `404` | `extract-message` 尚未部署，或函数名/项目 Ref 不一致 |
| `401` | 先在应用登录；检查 Supabase Auth 与 Function 授权 |
| `503` | 检查 `AI_PROVIDER`、`AI_MODEL`、`AI_API_KEY`，OpenAI 还需 `AI_BASE_URL` |
| `502` | 检查模型 ID、Key 限制/有效期、供应商配额和 Edge Function 日志；错误日志不会回显原消息 |

## 安全与费用

- AI 只在用户主动点击“分析消息”时收到该次提交文本；应用不读取 QQ/微信后台数据。
- 不要把 API Key 放到 `VITE_*` 环境变量中。Vite 变量会打进客户端包，任何拿到 APK 或安装包的人都可能提取。
- 使用供应商控制台设置预算、调用额度和密钥限制；一旦怀疑泄露，立即撤销旧 Key 并在 Supabase 替换。
- Gemini 免费层有配额限制，且提交内容可能用于改进 Google 产品；以 [官方最新定价和条款](https://ai.google.dev/gemini-api/docs/pricing) 为准。
- OpenAI API 与 ChatGPT 订阅分开计费；以 [官方 API 账单说明](https://help.openai.com/en/articles/9039756-managing-billing-for-the-chatgpt-and-the-api-platform) 为准。
