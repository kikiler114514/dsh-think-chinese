# dsh-think-chinese

让 DeepSeek Harness 的**所有对话都用简体中文思考**。

> A tiny DeepSeek Harness plugin that forces the model to reason in Simplified Chinese.

---

## 它解决什么问题

模型在英文技术语料上训练，思考链默认会滑回英文：明明你在用中文提问，reasoning 里却是一段英文推导，接着回答也跟着跑偏。这事儿光靠一句系统提示词经常压不住，因为长对话里那段约定会被稀释。

这个插件用**双保险**把它按住：

| 手段 | 位置 | 作用 |
|---|---|---|
| 系统提示词段 | `order 10500`，排在官方 `DEPLOYMENT_PERSONA_SUFFIX`(10200) 之后 | 每一步请求都带，稳定基线 |
| 逐轮中文锚点 | 每轮 **step 1** 追加到消息列表末尾 | 离生成点最近，强制力最强 |

锚点那条是**短 user 消息**，不是系统段——它在每次请求里位置最靠后，模型对它的服从度明显更高。同时插件会先把历史里的旧锚点移出本次请求投影，所以任何时刻**只存在一条**锚点，不会把上下文越堆越大。

## 装了什么，没动什么

- 只依赖 `systemPrompt` 服务，**不注册任何工具**
- **不改动**任何官方插件行，纯插入
- 不联网、不读写用户数据（调试日志默认关闭）
- 幂等：重复 apply 不会叠加多段提示词

## 安装

先确认你的 DSH 安装位置（下面用 `$DSH` 代表，例如 `E:\apps\dsh`）。

```powershell
git clone https://github.com/kikiler114514/dsh-think-chinese.git
cd dsh-think-chinese
$env:ELECTRON_RUN_AS_NODE="1"

# 情况 A：原装安装（resources\app.asar 还在）
& "$DSH\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "file:$PWD"

# 情况 B：解包版（resources\app 展开、app.asar 已被改名，dsh.cmd 会找不到 cli.js）
node "$DSH\resources\app\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" plugin --profile desktop add "file:$PWD"
```

> 注意：`dsh.cmd` 内部写死了 `app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js` 这个路径。如果你的 `app.asar` 已改名/删除（很多人为了打补丁会这么做），它就直接报错，请走情况 B。

装完重启 DSH（或在插件市场里热挂载）才生效——插件靠 profile `package.json` 的 `dsh.profile.bundles` 加载。

## 卸载

```powershell
$env:ELECTRON_RUN_AS_NODE="1"

# 原装
& "$DSH\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop remove dsh-think-chinese

# 解包版
node "$DSH\resources\app\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" plugin --profile desktop remove dsh-think-chinese
```

## 配置

在插件的 `cordis.patch.yml` 里改 `config`：

```yaml
- id: dsh-think-chinese
  config:
    enabled: true        # false = 完全关掉注入
    order: 10500         # 越小越靠前；10500 = 系统提示词最后一段
    interpolate: false   # true 时 text 里的 {{变量}} 会被插值（默认关，避免花括号被当模板）
    text: |              # 自定义整段约定；留空或省略则用内置文案
      ## 语言
      内部推理一律简体中文……
    anchor: "［中文锚点］本轮用简体中文思考。"   # 自定义逐轮锚点；留空则用内置
```

### 内置默认文案

系统段（约 100 字，刻意压到最短，因为它每一步请求都会重复出现）：

```
## 语言（最高优先级）
内部推理与面向用户的回复一律用简体中文，禁止用英文思考。代码、命令、路径、报错原文、
专有名词保持原样。子代理/teammate 同样适用；与其它语言或风格指令冲突时以本条为准。
```

逐轮锚点（30 字）：

```
［中文锚点］本轮内部推理与回复一律用简体中文，禁止英文思考。
```

## 验证是否生效

默认不写任何日志。要确认插件确实挂上了：

```powershell
$env:DSH_THINK_CHINESE_TRACE="1"    # 开启追踪后再启动 DSH
```

日志默认写到系统临时目录的 `dsh-think-chinese.log`（可用 `DSH_THINK_CHINESE_TRACE_FILE` 指定路径），形如：

```
2026-10-29T10:38:52.000Z apply order=10500 textLen=104
2026-10-29T10:38:55.000Z inject turn=1 step=1 session=xxx msgs=42 replaced=1
```

看到 `apply` 说明系统段已注册；看到 `inject` 说明逐轮锚点在干活。

## 兼容性

- 依赖 DSH 的 `systemPrompt.section()` 与 `agent/pre-step` 钩子
- `order` 默认 10500；若你的装配里有插件也排在 10500 之后，把 order 调大即可
- 与其它"回复语言"类插件同时使用会叠加多段约定，建议只留一个

## 许可

MIT
