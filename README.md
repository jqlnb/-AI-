# 智能化 AI 日程学习助手

面向大学生的本机优先学习日程工具。一个共享的触屏友好界面可封装为 Windows Electron 桌面应用或 Android Capacitor 应用；有 Supabase 项目时可启用账号、云端数据同步和 AI 消息识别。核心数据默认留在设备上。

**正式版本：** 1.1.0。Windows 电脑与 Android 手机使用同一 Supabase 账号登录后，可连接同一云端并同步课程、待办、提醒、审核草稿及完成状态；配置 Supabase 服务后即可启用跨设备同步。

**下载：** [GitHub Releases](https://github.com/jqlnb/-AI-/releases)（源码和安装包分开发布）。

## 功能

- 课程表 CSV / XLSX 导入，导入预览、逐行错误提示、重复检查，以及今日与周视图。
- 导入课程后默认排定上课前 15 分钟提醒；Android 使用系统本地通知，Windows 应用运行时弹出系统通知。可修改提前时间、关闭提醒，并填写学期第 1 周周一以按周次范围排程。
- 待办创建、修改、完成、恢复、删除、优先级、截止时间、筛选和 JSON 备份。
- 新建待办默认在截止前 1 小时安排自动提醒；可在设置中关闭默认提醒或调整提前时间，也可在单条任务上取消勾选。没有截止时间的任务不会伪造提醒时间。
- 用户主动粘贴 QQ/微信等消息，经可配置 AI 服务识别后先进入待审核；只有用户确认才创建正式待办。Android 可通过用户明确授权的通知读取能力，选择学习平台应用并在本机解析作业通知、自动创建正式待办。
- 一个任务可创建多条提醒。Android 使用本地通知；Windows 应用运行时使用系统通知；同一提醒只由创建它的设备安排本机通知。
- 可选 Supabase 邮箱认证、账号恢复、RLS 行级数据权限和基于 `updated_at` 的轻量冲突合并；账号登录状态保持，设备数据按用户隔离，切换账号不会删除原账号数据。
- 浅色 / 深色主题，桌面侧边栏与手机底部导航。

## 技术架构

- 客户端：原生 ES modules + Vite；Electron 负责 Windows 独立窗口，Capacitor 负责 Android WebView 壳及通知、设备偏好接口。
- 数据：IndexedDB 替代方案（浏览器 Web Storage）/ Capacitor Preferences 本地保存；可选 Supabase Auth + Postgres。
- AI：Supabase Edge Function 可代理 Gemini API 或 OpenAI/ChatGPT 兼容聊天接口；AI 密钥只放在 Edge Function secrets。
- 课程解析在本机运行；原始聊天文本仅在用户点击“分析消息”时发送，客户端不保存原文。

## 项目结构

```text
desktop/                 Electron 窗口与安全 preload
android/                 Capacitor Android 工程、通知读取服务与插件
web/                     共享客户端与移动优先 UI
web/src/core.mjs         课程格式解析与校验
backend/supabase.sql     表结构、索引和 RLS 策略
backend/functions/       AI 提取 Edge Function
examples/                CSV / XLSX 课程示例
assets/app.ico           Windows 应用图标
tests/                   Node 内置测试
```

## 环境变量

复制 `.env.example` 到 `.env`，只填写你自己的项目配置。不要提交 `.env`。

| 变量 | 用途 |
|---|---|
| `VITE_SUPABASE_URL` | Supabase 项目 URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key（`sb_publishable_...`），用于受 RLS 保护的客户端访问；旧项目也可用 `VITE_SUPABASE_ANON_KEY` |
| `VITE_AI_FUNCTION_URL` | 可选的 `extract-message` Edge Function 完整 URL；留空时自动从 Supabase URL 推导 |

AI Function 的 secrets 只配置在 Supabase Edge Function，不能写入 `.env`、Windows 客户端或 APK。函数支持 Gemini API 与 OpenAI 兼容接口：

- 优先尝试 Gemini 文本免费额度：`AI_PROVIDER=gemini`、`AI_MODEL=gemini-3.8-flash`、`AI_API_KEY=<Google AI Studio API key>`。免费额度有地区和调用频率限制，Google 对免费层提交内容的数据使用方式请先查看其[当前条款与定价](https://ai.google.dev/gemini-api/docs/pricing)；不要提交不愿交给第三方处理的聊天内容。API Key 配置和部署步骤见 [API Key 接入指南](docs/API-Key接入指南.md)。
- 如要使用 ChatGPT/OpenAI：`AI_PROVIDER=openai`、`AI_BASE_URL=https://api.openai.com/v1`、`AI_MODEL=<你账户可用的模型>`、`AI_API_KEY=<OpenAI API key>`。ChatGPT 订阅不包含 API 用量，API 需单独计费，见 [OpenAI API 账单说明](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform)。
- 也支持其他 OpenAI 兼容接口：设置 `AI_PROVIDER=openai-compatible` 并按提供商填写 `AI_BASE_URL`、`AI_MODEL` 和 `AI_API_KEY`。

消息仅在用户点击“分析消息”时发送到所配置的 AI；结果仍只进入待审核草稿，不会直接创建任务。原文不存入应用数据或错误日志。`VITE_AI_FUNCTION_URL` 可留空，客户端会从 Supabase URL 推导 Function 地址。

## 本地开发

需要 Node.js 20.19+ 或 22.12+。常规环境：

```powershell
npm install
npm run dev
```

在没有系统 npm 的环境，可使用项目内 npm CLI：

```powershell
node .tooling/package/bin/npm-cli.js install --no-audit --no-fund
node .tooling/package/bin/npm-cli.js run dev
```

本地浏览器只用于开发预览，不是最终产品的主要使用形态。核心课程、待办和备份无需登录或云端服务。

## Windows 客户端

在 Windows 上：

```powershell
npm run desktop
npm run desktop:build
```

安装包输出到 `release/`，可创建桌面快捷方式。当前 Windows 安装包未使用商业代码签名证书，Windows 可能显示未知发布者提示。系统通知需允许 Windows 通知。Windows 通知仅在桌面客户端进程仍运行时由该客户端调度；退出客户端后不会保证提醒，尚未配置云推送服务。

## Android 客户端

需安装 Android Studio、Android SDK 35、JDK 21，并配置 `ANDROID_HOME`。首次生成原生工程并同步：

```powershell
npm run android:sync
npm run android:open
```

手机侧载交付 APK 使用 `android/` 目录的 `gradlew.bat assembleRelease` 构建，输出在 `android/app/build/outputs/apk/release/app-release.apk`。当前 release variant 使用本机 Android debug 证书签名，可用于测试和覆盖安装，不是 Play 商店签名发布包。Android 13 及以上需要通知权限；Android 12 起精确提醒还受闹钟权限与厂商省电策略影响。Android 本地通知由系统排程并在重启后恢复。手机端打开“消息识别 → 学习平台通知接入”，先在系统设置中主动授权，再让学习通/智慧树产生一条通知，回应用勾选对应应用并启用。通知只在设备本机解析，原文只在待处理队列中短暂保存，生成待办后即清空；未识别截止时间时保持为空并标记待补充。撤销系统授权或关闭接入会停止读取。尚未实机验证厂商通知限制和不同学习平台通知格式。项目未配置 FCM 云推送。

## Supabase 配置与部署

1. 创建 Supabase 项目。
2. 在 SQL Editor 执行 `backend/supabase.sql`。所有用户数据表均启用 RLS，策略要求 `auth.uid() = user_id`。
3. 配置 Auth 邮箱注册、SMTP 与密码恢复邮件。
4. 配置 `.env` 的 Supabase URL 和 publishable key（或兼容的 anon key）。
5. 在 Supabase 项目 **Edge Functions → Secrets** 中配置所选 AI 提供商 secrets。免费额度 Gemini 示例：

```text
AI_PROVIDER=gemini
AI_MODEL=gemini-3.8-flash
AI_API_KEY=<从 Google AI Studio 获取的 API key>
```

或者按上方说明配置 OpenAI。API key 只放在 Supabase secrets，不能放在客户端 `.env`。然后安装 Supabase CLI 并登录，部署函数：

```powershell
supabase functions deploy extract-message
supabase functions deploy delete-account
```

6. `VITE_AI_FUNCTION_URL` 通常无需填写；客户端会根据 Supabase URL 推导函数地址。只有使用自定义地址时才填写该变量，并重新构建客户端。获取并配置 AI Key 请按 [API Key 接入指南](docs/API-Key接入指南.md) 操作。
7. 账号删除需要部署 `delete-account` Function；它用当前用户 JWT 确认身份，再用 Supabase Admin API 删除账号，关联数据由外键级联删除。不要把 service role key 放进客户端。

配置 Supabase 后，桌面与手机使用同一邮箱账号登录即可连接同一云端。客户端在登录、联网和本地数据变更后自动同步；Supabase Realtime 启用时，另一设备的数据变更也会触发刷新。冲突按 `updated_at` 较新的记录合并，删除通过软删除标记同步。提醒计划存云端，但系统通知限定在创建该提醒的设备，避免每台设备都重复排程。没有服务端推送凭证时，云端无法唤醒完全退出的客户端。

### 数据同步与软件更新的区别

Supabase 同步的是账号数据（课程、待办、审核草稿、提醒和设置），不会把新功能代码自动安装到 Windows 或 Android。当前客户端没有配置 Electron 自动更新源或 Android Live Update 服务；发布代码变更后，需要重新构建并分发 Windows 安装包和 Android APK，再由用户安装更新。不要把 Supabase Realtime 当作应用代码更新通道。Android OTA 需要单独选定并配置合规的发布渠道；Windows 自动更新也需要可访问的安装包发布源及签名发布配置。当前测试 APK 是未签名 Play 发布包的 debug 版本，适合侧载测试。

双端连接步骤：

1. 在项目根目录复制 `.env.example` 为 `.env`，填入同一 Supabase 项目的 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY`（旧版 anon key 也兼容）。
2. 在该项目的 SQL Editor 执行 `backend/supabase.sql`，并在 Auth 设置邮箱注册。
3. 用已配置 `.env` 重新构建 Windows 客户端与 Android APK。Windows 使用 `npm run desktop:build`；Android 使用 `npm run android:sync` 后在 `android/` 运行 `gradlew.bat assembleDebug`。
4. 两端使用同一个注册邮箱和密码登录；留在应用内时可通过 Realtime 自动刷新，也可在“设置 → 立即同步”手动重试。

Supabase URL/anon key 尚未提供时，客户端保留本机数据并显示离线/未配置状态，不会假称已连接。首次数据库配置或 SQL 变更后，建议在 Supabase Dashboard 确认 `courses`、`todos`、`drafts`、`reminders`、`user_settings` 已加入 `supabase_realtime` publication。

## 数据库结构

- `courses`：课程字段、学期、颜色、创建/更新时间、软删除时间。
- `todos`：任务描述、截止、优先级、来源、完成状态及时间戳。
- `drafts`：AI 结构化建议、来源、置信度、待审核状态及时间戳；不保存原始聊天文本。
- `reminders`：任务 ID、触发时间、设备 ID、通知 ID、触发时间、状态及时间戳。
- `user_settings`：用户偏好 JSON。

所有表含 user ownership；外键删除用户时级联删除数据。

## 隐私与 QQ / 微信导入限制

应用不读取聊天数据库、Cookie、私有接口或后台消息。QQ/微信仅接受用户主动复制粘贴的文字；当前不包含聊天记录文件导入。点击 AI 分析时，原文只发往你配置的 AI 服务，不写入数据库或应用日志，结果先进入审核草稿。Android 学习平台接入需系统通知读取授权和明确选择来源应用；只读取被选择应用通知标题与正文，在本机解析，不发送 AI，不记录原文日志。待处理通知队列最多暂存 50 条，处理后清空。Windows 不读取其他应用或手机通知。

## 通知与提醒限制

- Android 本地课程提醒可在应用关闭时触发，系统会在重启后恢复已排程通知；通知权限、精确闹钟权限、时区变化和厂商省电策略仍可能影响展示。时区变化后重新打开/切回应用会重排提醒；需真机验收。
- Windows 应用运行期间可显示系统通知；关闭应用后不承诺提醒。
- 设置中的设备提醒总开关和 Android / Windows 系统通知权限共同决定展示行为。
- 通知去重按 `device_id + reminder_id` 设计，同步到其他设备时不在其他设备再次排程。
- FCM/APNs/Windows 云端推送、重复提醒规则、手动更换自定义铃声尚未配置。
- 课程表没有学期起始日期字段，因此日期保存在现有用户设置 JSON 中；未填写时按每周重复排程、不按周次过滤，填写后按课程起止周筛选。

## 测试与构建

```powershell
npm test
npm run build
npm run desktop:build
npm run android:sync
```

测试覆盖 CSV 课程导入、星期/时间/周次规范化、错误行提示、时间段表达和重复识别、课程提醒周次/提前量、平台作业文本识别和缺失截止时间。云端 RLS 需要实际 Supabase 用户与项目才能进行端到端验证；AI 需要已部署函数和模型密钥；通知监听与系统通知需要真机授权后验收。

## 已知限制 / 下一阶段

- 当前为 MVP，账号、跨设备同步和 AI 需自行配置 Supabase 与模型服务；尚无已连接的线上服务。
- 本地待办编辑当前只开放标题快速修改；课程导入预览有错误时会阻止整批确认。
- 课程表尚未按真实学期周次动态过滤；PDF/OCR、消息文件导入、学习规划和统计暂未实现。
- 账号删除依赖已部署的 `delete-account` Edge Function；没有 Supabase 配置时该按钮不可用。
- Android 项目需 Android SDK 本机构建；无凭证的 CI/当前开发机不能生成签名发布包。
- 后续推荐：课程/待办完整编辑表单、账号安全删除函数、Android 图标、云推送、真实设备多端冲突与通知震动/权限验收、PDF/OCR 导入。
