# CAIE Marking Training — 项目接手指南（给 AI 维护者）

任何 AI 接手本项目前必读本文。项目无构建步骤、无框架，改动直接生效于静态文件。

## 项目是什么

CAIE 教师批卷训练系统：老师打开网页 → 选择学科/试卷/答卷 → 左栏看学生答卷扫描件、中栏看官方评分标准（Mark Scheme）、右栏逐小题打分 → 提交后系统逐题对比官方分并给出讲解（commentary）。用于国际学校物理组教师培训。

- 线上地址: https://edisonbone-beep.github.io/caie-marking-training/
- 仓库: https://github.com/edisonbone-beep/caie-marking-training （用户: edisonbone-beep）
- 本地路径: `~/Desktop/Marking Training/`
- Admin 密码: `123456`（明文在 main.js，已知隐患，见"待办"）
- 数据库: Supabase 项目 `kyhbgkfetxmqtegjhqsz`，表 `marking_results`，publishable key 硬编码在前端（公开可读，RLS 允许匿名读写）

## 架构

纯静态站 + 海外 BaaS，**没有构建工具、没有框架、没有 npm**：

```
index.html        全部页面结构（登录/选择/批卷/结果）+ 全部 CSS（单文件内嵌）
main.js           全部逻辑
papers-data.js    var PAPERS = {...}  9 套卷的全部数据（纯 JSON 风格）
img/              342 张扫描图（约 45MB）
server/server.py  国内自建后端（备用，当前休眠）
compress_images.py 图片压缩工具（新图入库前跑）
```

数据流：老师提交 → `main.js` 的 `apiInsertResult()` 写入 → admin 端 `apiFetchResults()` 读取渲染 Dashboard。

**数据层双模式开关**（main.js 顶部）：`USE_DOMESTIC_API=false` 时走 Supabase；改成 `true` 并填 `DOMESTIC_API` 后走 `server/server.py`（Python 标准库零依赖，JSON 文件存储，接口 `/api/health` `/api/auth` `/api/results` GET/POST/DELETE，鉴权用 `x-admin-password` 请求头）。2026-08 用户决定暂不迁移国内，此开关保持 false。切换后 admin 密码改由服务端校验。

## papers-data.js 数据规则（改前必读）

每卷结构：
```
category: "IG"|"AL"
subject: "0625 Physics"|"9702 Physics"   ← 按空格取最后一词 = 学科 tab 名
paper, fullMark, msImages[], scripts: {A: {images: [...]}},
feedback: { <scriptId>: { totalMark, questions: [...] } }
```

`feedback.questions[]` 每项：`{label:"1(b)(iii)", officialMark, maxMark, commentary}`。

**不变式（校验标准）**：每卷每答卷 `sum(maxMark) == fullMark` 且 `sum(officialMark) == totalMark`。任何数据修改后必须重新校验（写个脚本 JSON 解析后求和即可，2026-08-27 已按此全量核对修复过一轮）。commentary 文本里常含分数线索（"2/2"、"awarded 6 marks"），核对错录时先看它。

label 惯例：题号+字母+罗马数字（1(b)(iii)）；实践卷 P3/P5 用自定义描述标签（如 "1(b) readings"、"1-D1"）。

## 常见维护操作

1. **新增试卷**：图片放 `img/`（命名 `{paperKey}_ms_N.jpg` / `{paperKey}_s{字母}_N.jpg`）→ 先跑 `python3 compress_images.py` 压超限大图（>2000px 宽或 >400KB 自动缩到 2000px/q80）→ `papers-data.js` 加条目并跑不变式校验 → 新学科需把 `main.js` 里 `ALL_SUBJECTS` 对应项的 `hasData` 改 `true`。
2. **改了 main.js 或 papers-data.js 后**：必须把 `index.html` 底部 script 标签的 `?v=N` 升一位（当前 v=4），否则浏览器缓存旧文件、线上不更新。
3. **提交推送**（本机直连 GitHub 不通）：
   ```
   git -c http.version=HTTP/1.1 -c http.proxy=http://127.0.0.1:7892 push origin main
   ```
   PAT 已存 macOS 钥匙串。若 SSL 报错重试一两次即可。
4. **清空批卷数据**（Supabase 模式）：`supabase.from('marking_results').delete().gte('id',0)`——delete 必须带过滤条件，且不返回被删行数，需另发 select 验证。

## 已知问题 / 待办

- **al2_p51/D 的 feedback 缺整个 Q1**（Planning 题，15 分，该生得 4 分）。答卷扫描件上无阅卷批注，4 分在四个评分维度（定义问题 2 / 数据收集 4 / 分析方法 3 / 细节与安全 6）中的分布未知，等用户提供后补全。
- **al_p3(C/D)、al_p5(G)** 的 feedback 用自定义评分点标签且只覆盖部分分值（17/40、23/40、7/30），是有意只练部分评分点还是未录完，待用户确认。
- Admin 密码明文在前端。若将来切国内模式（server.py），密码改服务端校验即自然解决。
- 大陆访问 github.io 慢或需代理（托管位置决定，无法根治）。如需国内无翻墙使用：买国内轻量服务器 → 部署静态站 + server.py → IP 直连访问 → 打开 `USE_DOMESTIC_API`。备案路线用户已明确放弃。

## 本机环境注意（在这台 Mac 上干活时）

- Python 必须用 `/usr/bin/python3`（3.9.6）；裸 `python3` 会被 SIGKILL；无 Node/npm；Homebrew 已损坏。
- 海外网络（github、supabase）需走本地代理 `127.0.0.1:7892` 且不稳定，报 SSL/HTTP2 错误就重试或加 `-c http.version=HTTP/1.1`。
- 线上验证时 GitHub Pages 缓存顽固：页面 URL 加随机参数，或强制刷新。
- Supabase 在本机时常 fetch 失败（网络原因非代码问题），验证数据功能可用本地 server.py 起服务替代。
