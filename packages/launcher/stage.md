# 第二阶段：Agent 应用市场（Agent Marketplace）

## 项目目标

打造类似 Anaconda Navigator 的 Agent 应用发现、安装、管理体验。

用户应该能够像浏览应用商店一样：

- 浏览 Agent
- 搜索与分类筛选
- 查看详情
- 安装 / 更新 / 卸载
- 查看版本
- 自动完成初始化配置
- 接收更新通知

---

# ⚠️ 重要实现要求（必须遵守）

## 必须参考 `launcher-legacy` 目录中的现有逻辑实现

当前项目中：

```bash
launcher-legacy/
```

目录下的实现逻辑、数据结构、安装流程、状态管理、UI 交互方式是“正确实现”。

所有新功能必须：

- 优先复用 launcher-legacy 的逻辑
- 保持 registry 数据结构兼容
- 保持 installer/install manager 行为兼容
- 保持 Agent 生命周期管理一致
- 不允许重新设计已有安装架构
- 不允许绕过 legacy 安装流程

---

# 开发前必须阅读的目录

请优先阅读：

```bash
launcher-legacy/
```

中的：

- registry 读取逻辑
- install manager
- installer.js
- agent-manager.js
- installed_agents.json
- dashboard / tray 相关逻辑
- install tab UI
- 状态管理逻辑

---

# 核心约束

新代码必须：

- 基于 legacy 逻辑扩展
- 不允许推翻式重构
- 保持状态结构兼容
- 保持 Agent metadata 兼容
- 保持安装目录结构兼容
- 保持更新机制兼容

---

# 阶段目标

实现一个完整的：

# Agent Marketplace / Agent Store

体验参考：

- Anaconda Navigator
- VSCode Extension Marketplace
- Raycast Store
- Docker Desktop Extensions

---

# 2.1 目录页分类筛选与排序（P0）

## 目标

基于 `registry.json` 中已有字段实现：

- 分类筛选
- Featured 推荐
- 排序
- Grid/List 切换
- 搜索

---

## 必须使用的 registry 字段

```json
{
  "tags": [],
  "featured": true,
  "order": 1
}
```

---

## 支持的分类

```txt
coding
open-source
cli
ide-extension
productivity
ai-tools
automation
devtools
```

---

## 功能要求

### 分类筛选

支持：

- 单选 / 多选 tags
- featured 筛选
- 已安装筛选

---

### 排序

支持：

- 推荐（order）
- 最新
- 热门
- 名称

---

### UI 展示

支持：

- Grid View
- List View

并保存用户偏好。

---

### 搜索

支持：

- 名称搜索
- tag 搜索
- description 搜索

支持 debounce。

---

## 涉及文件

重点参考：

```bash
launcher-legacy/
```

中的：

- Install Tab
- registry 加载逻辑
- agent list rendering

---

## 建议新增组件

```bash
src/components/install/
```

建议新增：

```txt
MarketplaceFilter.tsx
MarketplaceSearch.tsx
MarketplaceSort.tsx
MarketplaceViewToggle.tsx
```

---

# 2.2 Agent 详情页（P0）

## 目标

实现完整 Agent Detail 页面。

用户从列表点击进入详情页。

---

## 页面内容

### 基础信息

显示：

- 名称
- 作者
- 版本
- 描述
- tags
- 发布时间

---

### 展示内容

支持：

- Logo/Icon
- Screenshot Gallery
- Demo 视频
- README 渲染

---

### 外部链接

支持：

- Homepage
- GitHub
- Documentation

---

### 系统要求

显示：

- OS 要求
- Node/Python/runtime 要求
- GPU 要求（如果有）

---

### 依赖项

展示：

- npm dependencies
- python dependencies
- system packages

---

### 环境变量配置

实现：

- ENV 配置弹窗
- Secret 输入
- 本地保存

注意：

- Secret 不允许明文打印
- 不允许在日志中输出敏感信息

---

### 安装操作

支持：

- Install
- Update
- Uninstall
- Retry

必须复用：

```bash
launcher-legacy/
```

中的安装逻辑。

---

### 使用指引

展示：

- Quick Start
- First Run Guide
- Example Commands

---

## 建议新增目录

```bash
src/components/agent-detail/
```

---

## 建议新增组件

```txt
AgentDetail.tsx
AgentHeader.tsx
AgentScreenshots.tsx
AgentDependencies.tsx
AgentEnvConfig.tsx
AgentInstallActions.tsx
AgentReadme.tsx
```

---

# 2.3 安装体验优化（P1）

## 当前问题

当前安装流程：

- 全屏终端输出
- 阻塞 UI
- 用户无法理解阶段状态

需要重构。

---

# 新安装流程

改为：

```txt
1. Downloading
2. Extracting
3. Installing Dependencies
4. Validating
5. Completed
```

---

## 必须实现

### 阶段进度条

显示：

- 当前阶段
- 子任务
- 百分比

---

### 日志折叠

支持：

- 简略模式
- 展开完整日志

---

### 后台安装

安装过程不能阻塞 UI。

要求：

- worker/thread/process
- 异步事件更新

---

### 错误处理

支持：

- Retry
- Copy Logs
- Report Issue

---

## 必须参考

```bash
launcher-legacy/
```

中的：

```bash
agent-manager.js
installer.js
```

---

## 注意

不要重写核心安装逻辑。

应改造：

- 状态派发
- progress events
- UI 层

---

# 2.4 安装后引导（P1）

## 目标

安装完成后自动进入：

# Setup Wizard

减少用户从安装到使用的摩擦。

---

# 引导流程

## Step 1

配置：

- API Key
- Token
- Endpoint

---

## Step 2

测试连接：

```txt
Test Connection
```

---

## Step 3

创建第一个 Agent 实例。

---

## Step 4

进入 Dashboard。

---

## 建议新增目录

```bash
src/components/setup-wizard/
```

---

## 建议新增组件

```txt
SetupWizard.tsx
SetupApiConfig.tsx
SetupConnectionTest.tsx
SetupCreateInstance.tsx
```

---

# 2.5 版本管理（P2）

## 当前问题

当前：

```bash
installer.js
```

仅支持：

- install
- uninstall

没有版本跟踪。

---

# 必须实现

## 已安装版本跟踪

扩展：

```bash
installed_agents.json
```

新增：

```json
{
  "installedVersion": "",
  "availableVersion": "",
  "lastUpdatedAt": ""
}
```

---

## 更新能力

支持：

- 检测更新
- 一键更新
- 回滚版本

---

## 更新策略

支持：

- Stable
- Beta
- Nightly

---

## 注意事项

必须兼容 legacy 数据结构。

不能破坏旧版本读取。

---

# 2.6 更新通知与变更日志（P2）

## 目标

当有新版本时：

- Dashboard 提示
- Tray 提示
- 更新日志预览

---

# 必须实现

## 更新提醒

显示：

```txt
Update Available
```

支持：

- Ignore
- Later
- Update Now

---

## Changelog Preview

展示：

- Features
- Fixes
- Breaking Changes

---

## 一键更新

点击后：

- 直接进入 update flow

---

## 涉及模块

参考：

```bash
launcher-legacy/
```

中的：

- Dashboard
- Tray Menu

扩展通知能力。

---

# 数据结构要求

## registry.json 建议结构

```json
{
  "id": "example-agent",
  "name": "Example Agent",
  "description": "Agent description",
  "version": "1.0.0",
  "author": "Author",
  "tags": ["coding", "open-source"],
  "featured": true,
  "order": 1,
  "homepage": "",
  "github": "",
  "docs": "",
  "screenshots": [],
  "requirements": {
    "os": [],
    "node": "",
    "python": "",
    "gpu": ""
  },
  "dependencies": {
    "npm": [],
    "python": [],
    "system": []
  }
}
```

---

# 技术实现要求

## 前端技术栈

建议：

- React
- Electron
- TypeScript

---

## 状态管理

必须保持与 legacy 一致。

不允许引入破坏性状态结构。

---

## 安装流程

必须：

- 兼容 installer.js
- 兼容 agent-manager.js
- 保持安装目录结构一致

---

# UI 风格目标

参考：

- Anaconda Navigator
- VSCode Marketplace
- Raycast Store

---

# 优先级

| 功能           | 优先级 |
| -------------- | ------ |
| 分类筛选与排序 | P0     |
| Agent 详情页   | P0     |
| 安装体验优化   | P1     |
| 安装后引导     | P1     |
| 版本管理       | P2     |
| 更新通知       | P2     |

---

# 最终目标

用户最终可以：

- 浏览 Agent Marketplace
- 搜索与筛选 Agent
- 查看完整详情
- 一键安装
- 自动初始化配置
- 管理版本
- 接收更新通知

形成完整的：

# Agent 应用商店体验

并且整个实现：

# 必须建立在 launcher-legacy 的正确逻辑之上
