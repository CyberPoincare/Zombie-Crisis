<div align="center">
<img width="1200" alt="Zombie Crisis Banner" src="resources/banner.jpg" />

# Zombie Crisis: OSM Operations

**基于真实世界的生存模拟管理游戏**

[![Version](https://img.shields.io/badge/version-1.4.3-blue.svg)](package.json)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-Repo-181717.svg)](https://github.com/CyberPoincare/Zombie-Crisis)

</div>

<p align="center">
  Language: <b>简体中文</b> | <a href="README_en.md">English</a>
</p>

---

## 🏗️ 项目简介

**Zombie Crisis: OSM Operations** 是一款基于 **OpenStreetMap (OSM)** 数据的实时生存模拟管理游戏。玩家将扮演战区指挥官，在全球任何真实的街道上指挥特种小队、部署空中补给、实施精确打击，并保护平民免受僵尸病毒的侵害。

本作深度集成了 **Google Gemini 2.0 AI**，为游戏注入了动态的战术分析与极具沉浸感的无线电通讯体验。

---

## ✨ 核心特性

- **🌍 真实世界战场**:
  - 基于 Leaflet 与 Overpass API，支持在全球任何地点开启战斗。
  - 动态加载现实世界的建筑物、道路与地标。
- **🤖 Gemini 2.0 深度集成**:
  - **动态通讯**: AI 根据当前真实街道（如“西玉龙街”）与地标生成实时无线电报告。
  - **战术扫描**: 对特定建筑进行深度扫描，获取由 AI 生成的生存指南与战场态势报告。
- **🧠 智能实体仿真**:
  - 支持数百个实体（僵尸、平民、士兵）同时活动，基于 Boids 避障与引导算法。
  - 角色具备独立的心情系统、内心活动气泡及自言自语逻辑。
- **📡 实时战术 HUD**:
  - **可缩放通讯窗**: 实时监控战场动态，支持点击定位与队员追踪。
  - **建筑探测器**: 自动识别建筑战术属性（防御价值、安全等级）。
- **🔊 沉浸式音效控制**:
  - 具备地理空间感的音频系统，根据战场焦距动态调整音效优先级。
  - 包含武器、平民尖叫、感染者咆哮等全方位的音效库。

---

## 🛠️ 技术架构

项目采用现代前端工程化方案，注重实时状态处理效率：

- **核心框架**: React 19 + TypeScript
- **地图驱动**: [Leaflet](https://leafletjs.com/) & [React-Leaflet](https://react-leaflet.js.org/)
- **AI 引擎**: [Google Gemini 2.0 Flash](https://aistudio.google.com/)
- **构建/部署**: [Vite](https://vitejs.dev/) + ESP (Electronic Sandbox Platform) 逻辑

---

## 🚀 快速开始

### 1. 环境准备

- [Node.js](https://nodejs.org/) (推荐 v18+)
- **Google Gemini API Key**: 驱动 AI 无线电与战术分析的核心组件。

### 2. 获取 API Key

访问 [Google AI Studio](https://aistudio.google.com/app/apikey) 免费获取你的 API Key。

### 3. 本地运行

1.  **克隆并安装**:

    ```bash
    git clone https://github.com/CyberPoincare/Zombie-Crisis.git
    cd Zombie-Crisis
    npm install
    ```

2.  **环境变量配置**:
    在根目录创建 `.env.local` 文件：

    ```bash
    GEMINI_API_KEY=你的_API_KEY_在这里
    ```

3.  **启动开发服务器**:

    ```bash
    npm run dev
    ```

    默认访问地址: `http://localhost:3000`

---

## 📖 游戏设定 (Game Settings)

欲了解游戏的详细机制、角色行为、感知系统及武器数值，请参考：
👉 **[游戏设定说明](doc/game_settings.md)**

---

## 📜 变更日志 (Changelog)

欲了解项目的详细更新历史（包括各版本的具体改进），请参阅：
👉 **[CHANGELOG.md](CHANGELOG.md)**

---

<div align="center">
  持续开发中... 欢迎提交 Issue 或 Pull Request！
</div>
